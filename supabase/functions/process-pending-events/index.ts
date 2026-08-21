/**
 * process-pending-events — background worker for the unified webhook queue.
 *
 * Sources:
 *   • 'bridge' — active events (customer KYC/KYB, virtual accounts, wallets, transfers).
 *
 * Top-level dispatch is on `pending_events.source`. Unknown sources fail
 * closed (no fall-through).
 *
 * Two invocation paths:
 *   1. Supabase Database Webhook on INSERT into pending_events (low-latency).
 *      Body: `{ type: 'INSERT', table: 'pending_events', record: { event_id, ... } }`
 *      We process *that one* event and return.
 *   2. pg_cron every minute (safety net + retries).
 *      Body: `{ mode: 'drain', batch_size?: number }` or empty.
 *      We claim a batch via `claim_pending_events` and drain it.
 *
 * Concurrency:
 *   - Multiple workers can run in parallel safely. Claims use
 *     SELECT ... FOR UPDATE SKIP LOCKED so no event is processed twice.
 *
 * Transactional safety:
 *   - All balance mutations + status flips go through
 *     `apply_wallet_transaction_and_complete()` which runs as ONE Postgres
 *     transaction. Either the wallet update + tx insert + status='completed'
 *     all commit, or none of them do — we never end up with a debited wallet
 *     and a still-queued event.
 *
 * Failure handling:
 *   - On error, `fail_pending_event()` increments attempts and reschedules
 *     with exponential backoff (30s × 2^(attempts-1), capped at 15 min).
 *   - After max_attempts (default 6), the row terminates as 'failed' and
 *     surfaces in the admin panel for manual reconciliation.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { isBridgeBlocked, isBridgeCustodialWalletSupported } from "../_shared/providers/bridge-country-policy.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";
import {
  assertBridgeIngressDecision,
  evaluateBridgeIngressEvent,
  type BridgeIngressDecision,
} from "../_shared/bridge-ingress-evaluator.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNTHETIC_EVENTS_ENABLED = (Deno.env.get("SYNTHETIC_EVENTS_ENABLED") ?? "false").toLowerCase() === "true";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;

// ── Webhook-email ────────────────────────────────────────────────────────────
// All sends route through the logged `send-email` function (Brevo transport) and
// are BEST-EFFORT: an email failure must never fail webhook processing.
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
type AccountType = "individual" | "business";
type TransactionEmailStatus = "in_review" | "approved" | "canceled" | "refunded" | "refund_in_flight";

// Suppression config (DB/env only — never decided from the webhook payload).
// An UNSET env var keeps the default; an explicitly empty value disables it
// (e.g. to allow an operator smoke test).
function envList(name: string, fallback: string[]): string[] {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
const EMAIL_SUPPRESS_LIST    = () => envList("WEBHOOK_EMAIL_SUPPRESS_LIST", []);
const EMAIL_SUPPRESS_DOMAINS = () => envList("WEBHOOK_EMAIL_SUPPRESS_DOMAINS", ["borderpayafrica.com"]);

/**
 * Resolve the email recipient for a mapped user, applying the suppression
 * predicate entirely from DB + env (never the webhook payload). Returns null
 * when the email must be suppressed: no user, no/absent email, is_admin,
 * suppress-list, suppress-domain, or unconfirmed email.
 */
async function resolveEmailRecipient(userId: string): Promise<{ email: string; full_name: string | null } | null> {
  if (!userId) return null;
  const { data: prof } = await supabase
    .from("user_profiles")
    .select("email, is_admin, full_name")
    .eq("id", userId)
    .maybeSingle();
  const email = prof?.email ? String(prof.email).trim() : "";
  if (!email) return null;
  if (prof?.is_admin === true) return null;
  const lower  = email.toLowerCase();
  const domain = lower.split("@")[1] ?? "";
  if (EMAIL_SUPPRESS_LIST().includes(lower)) return null;
  if (EMAIL_SUPPRESS_DOMAINS().includes(domain)) return null;
  // Email confirmation lives in auth.users (not user_profiles). Skip unconfirmed.
  const { data: au } = await supabase.auth.admin.getUserById(userId);
  if (!au?.user?.email_confirmed_at) return null;
  return { email, full_name: prof?.full_name ?? null };
}

/**
 * Best-effort terminal KYC/KYB decision email. NEVER throws — a failure is
 * logged and swallowed so webhook processing still completes. Recipient +
 * suppression are resolved from DB/env. Idempotency is keyed on the user,
 * template, and terminal decision so a kyc_link.* decision plus the matching
 * customer.* terminal status collapse into one customer email.
 */
async function emailKycDecisionBestEffort(
  userId: string,
  isKyb: boolean,
  decision: "approved" | "rejected",
): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(userId);
    if (!rcpt) return;

    let template: string;
    let props: Record<string, unknown>;
    if (isKyb) {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", userId)
        .maybeSingle();
      template = "business.kyb_decision";
      props = { company_name: biz?.company_name ?? null, decision };
    } else {
      template = "individual.kyc_decision";
      props = { full_name: rcpt.full_name, decision };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to:              rcpt.email,
        user_id:         userId,
        idempotency_key: `wh:kyc:${userId}:${template}:${decision}`,
        props,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email kyc/kyb send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email kyc/kyb best-effort error: ${(e as Error).message}`);
  }
}

/** Notify the customer once when Bridge transitions the account to paused. */
async function emailAccountPausedBestEffort(
  userId: string,
  accountType: AccountType,
  bridgeCustomerId: string,
  pausedAt: string,
): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(userId);
    if (!rcpt) return;

    const isBusiness = accountType === "business";
    let companyName: string | null = null;
    if (isBusiness) {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", userId)
        .maybeSingle();
      companyName = biz?.company_name ?? null;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template: isBusiness ? "business.account_suspended" : "individual.account_suspended",
        to: rcpt.email,
        user_id: userId,
        idempotency_key: `wh:account-paused:${bridgeCustomerId}:${pausedAt}`,
        props: isBusiness
          ? {
              full_name: rcpt.full_name,
              company_name: companyName,
              reason_public: "Your business account is temporarily restricted while we complete a review.",
            }
          : {
              full_name: rcpt.full_name,
              reason_public: "Your account is temporarily restricted while we complete a review.",
            },
      }),
    });
    if (!res.ok) {
      const message = await res.text().catch(() => "");
      console.log(`webhook-email account-paused send failed: HTTP ${res.status} ${message.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`webhook-email account-paused best-effort error: ${(error as Error).message}`);
  }
}

function currentMonthEndDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

/** Separate post-approval maintenance notice; never combined with KYC/KYB or account-limit emails. */
async function emailAccountMaintenanceFeeBestEffort(userId: string, accountType: AccountType): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(userId);
    if (!rcpt) return;

    const billingStartDate = currentMonthEndDate();
    let template: string;
    let props: Record<string, unknown>;
    if (accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", userId)
        .maybeSingle();
      template = "business.account_maintenance_fee";
      props = { company_name: biz?.company_name ?? null, billing_start_date: billingStartDate };
    } else {
      template = "individual.account_maintenance_fee";
      props = { full_name: rcpt.full_name, billing_start_date: billingStartDate };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: userId,
        idempotency_key: `wh:account-maintenance-approved:${userId}:v1`,
        props,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email account-maintenance send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email account-maintenance best-effort error: ${(e as Error).message}`);
  }
}

async function emailTransactionStatusBestEffort(params: {
  userId: string;
  accountType: AccountType;
  status: TransactionEmailStatus;
  amount: number;
  currency: string;
  reference: string;
  description?: string | null;
  occurredAt?: string | null;
  idempotencyKey: string;
  grossAmount?: number | null;
  developerFeeAmount?: number | null;
  exchangeFeeAmount?: number | null;
  netAmount?: number | null;
  sourceCurrency?: string | null;
  sourceAmount?: number | null;
  serviceChargeAmount?: number | null;
  availableAmount?: number | null;
  destinationCurrency?: string | null;
  destinationAmount?: number | null;
  exchangeRate?: number | null;
  destinationAddress?: string | null;
  sourceRail?: string | null;
  depositId?: string | null;
  refundReturnReason?: string | null;
  refundReturnedAt?: string | null;
  refundRiskRejectionReason?: string | null;
  refundRail?: string | null;
  refundBeneficiaryName?: string | null;
  refundReferenceId?: string | null;
}): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;

    const template = params.accountType === "business"
      ? "business.transaction_status"
      : "individual.transaction_status";
    let props: Record<string, unknown> = {
      status: params.status,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      description: params.description ?? null,
      occurred_at: params.occurredAt ?? null,
      gross_amount: params.grossAmount ?? null,
      developer_fee_amount: params.developerFeeAmount ?? null,
      exchange_fee_amount: params.exchangeFeeAmount ?? null,
      net_amount: params.netAmount ?? null,
      source_currency: params.sourceCurrency ?? null,
      source_amount: params.sourceAmount ?? null,
      service_charge_amount: params.serviceChargeAmount ?? params.developerFeeAmount ?? null,
      available_amount: params.availableAmount ?? params.netAmount ?? null,
      destination_currency: params.destinationCurrency ?? null,
      destination_amount: params.destinationAmount ?? null,
      exchange_rate: params.exchangeRate ?? null,
      destination_address: params.destinationAddress ?? null,
      source_rail: params.sourceRail ?? null,
      deposit_id: params.depositId ?? null,
      refund_return_reason: params.refundReturnReason ?? null,
      refund_returned_at: params.refundReturnedAt ?? null,
      refund_risk_rejection_reason: params.refundRiskRejectionReason ?? null,
      refund_rail: params.refundRail ?? null,
      refund_beneficiary_name: params.refundBeneficiaryName ?? null,
      refund_reference_id: params.refundReferenceId ?? null,
    };
    if (params.accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", params.userId)
        .maybeSingle();
      props = { ...props, company_name: biz?.company_name ?? null };
    } else {
      props = { ...props, full_name: rcpt.full_name };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: params.idempotencyKey,
        props,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email transaction-status send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email transaction-status best-effort error: ${(e as Error).message}`);
  }
}

async function emailWalletActivityBestEffort(params: {
  userId: string;
  accountType: AccountType;
  direction: "credit" | "debit";
  amount: number;
  currency: string;
  reference: string;
  description?: string | null;
  occurredAt?: string | null;
  newBalance?: number | null;
  idempotencyKey: string;
}): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;

    const template = params.accountType === "business"
      ? "business.transaction_notification"
      : "individual.transaction_notification";
    let props: Record<string, unknown> = {
      direction: params.direction,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      description: params.description ?? null,
      occurred_at: params.occurredAt ?? null,
      new_balance: params.newBalance ?? null,
    };
    if (params.accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", params.userId)
        .maybeSingle();
      props = { ...props, company_name: biz?.company_name ?? null };
    } else {
      props = { ...props, full_name: rcpt.full_name };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: params.idempotencyKey,
        props,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email wallet-activity send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email wallet-activity best-effort error: ${(e as Error).message}`);
  }
}

async function emailGlobalAccountReadyBestEffort(params: {
  userId: string;
  accountType: AccountType;
  currency: string;
  virtualAccountId: string;
}): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;

    let template: string;
    let props: Record<string, unknown>;
    if (params.accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", params.userId)
        .maybeSingle();
      template = "business.account_ready";
      props = {
        company_name: biz?.company_name ?? null,
        product: "virtual_account",
        outcome: "provisioned",
        currency: params.currency,
      };
    } else {
      template = "individual.account_ready";
      props = {
        full_name: rcpt.full_name,
        product: "virtual_account",
        outcome: "provisioned",
        currency: params.currency,
      };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: `wh:va-ready:${params.userId}:${params.virtualAccountId}:${params.currency}`,
        props,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email global-account-ready send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email global-account-ready best-effort error: ${(e as Error).message}`);
  }
}

async function emailVirtualAccountLimitsBestEffort(params: {
  userId: string;
  accountType: AccountType;
  bridgeCustomerId: string;
}): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;

    const { data: vaRows } = await supabase
      .from("bridge_virtual_accounts")
      .select("currency,rail,status,account_details")
      .or(`user_id.eq.${params.userId},business_user_id.eq.${params.userId}`)
      .eq("status", "active")
      .in("currency", ["USD", "EUR", "GBP"]);

    const virtualAccounts = (vaRows || []).map((row: Record<string, unknown>) => {
      const currency = String(row.currency || "").toUpperCase();
      const accountDetails = row.account_details && typeof row.account_details === "object"
        ? row.account_details as Record<string, unknown>
        : {};
      const source = accountDetails.source_deposit_instructions && typeof accountDetails.source_deposit_instructions === "object"
        ? accountDetails.source_deposit_instructions as Record<string, unknown>
        : {};
      const railRaw = String(row.rail || source.payment_rail || (Array.isArray(source.payment_rails) ? source.payment_rails[0] : "") || "").toLowerCase();
      const rail = railRaw === "ach" || railRaw === "ach_push"
        ? "ACH / Wire / FedNow"
        : railRaw === "sepa"
          ? "SEPA"
          : railRaw === "faster_payments"
            ? "Faster Payments"
            : currency === "USD"
              ? "ACH / Wire / FedNow"
              : currency === "EUR"
                ? "SEPA"
                : currency === "GBP"
                  ? "Faster Payments"
                  : "Bank transfer";
      if (currency === "USD") {
        return {
          currency,
          rail,
          account_label: `${currency} - ${rail}`,
          minimum: "No published minimum",
          maximum: "No published standard maximum",
          accepted_payments: "Own-account payments, business payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000.",
          important_note: "USD person-to-person payments must stay under $4,000 and are not supported from New York or Texas.",
        };
      }
      if (currency === "EUR") {
        return {
          currency,
          rail,
          account_label: `${currency} - ${rail}`,
          minimum: "No published minimum",
          maximum: "No published standard maximum. Payments over EUR 1,000,000 use SEPA Credit and may take 1 business day.",
          accepted_payments: "Own-account payments and business payments are supported. Contact BorderPay before receiving EUR SEPA from an individual.",
          important_note: "Individual third-party EUR SEPA payments need support review before use. Contact us first to avoid a preventable refund.",
        };
      }
      return {
        currency,
        rail,
        account_label: `${currency} - ${rail}`,
        minimum: "No published minimum",
        maximum: "No published standard maximum. Payments over GBP 1,000,000 use BACS and may take 3 business days.",
        accepted_payments: "Own-account payments and business payments are supported.",
        important_note: "GBP does not support incoming payments from individuals. Use GBP for company, employer, platform, or client business payments only.",
      };
    });

    const template = params.accountType === "business"
      ? "business.virtual_account_limits"
      : "individual.virtual_account_limits";
    let props: Record<string, unknown> = {
      full_name: rcpt.full_name,
      virtual_accounts: virtualAccounts,
      action_url: `${Deno.env.get("APP_URL") || "https://app.borderpayafrica.com"}/dashboard`,
    };
    if (params.accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", params.userId)
        .maybeSingle();
      props = {
        ...props,
        company_name: biz?.company_name ?? null,
      };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: `wh:verified-account-limits:${params.userId}:${params.bridgeCustomerId}:v1`,
        props,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email virtual-account-limits send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email virtual-account-limits best-effort error: ${(e as Error).message}`);
  }
}

interface PendingEvent {
  id:           string;
  event_id:     string;
  source:       string;
  event_type:   string;
  payload:      Record<string, unknown>;
  attempts:     number;
  max_attempts: number;
}

const DEFAULT_STABLECOIN_WALLETS: ReadonlyArray<{ symbol: "USDC" | "USDT"; chain: "BASE" | "TRON" }> = [
  { symbol: "USDC", chain: "BASE" },
  { symbol: "USDT", chain: "TRON" },
];

const PROVISIONING_LOCK_STALE_SECONDS = 180;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function provisioningLockEventId(customerId: string, symbol: string, chain: string): string {
  return `provlock:wallet:${customerId}:${symbol.toUpperCase()}:${chain.toLowerCase()}`;
}

type ProvisioningLockResult =
  | { state: "acquired" | "stale_acquired"; lockEventId: string }
  | { state: "busy" | "already_completed"; lockEventId: string };

async function tryAcquireProvisioningLock(customerId: string, symbol: string, chain: string): Promise<ProvisioningLockResult> {
  const lockEventId = provisioningLockEventId(customerId, symbol, chain);
  const nowIso = new Date().toISOString();
  const payloadHash = await sha256Hex(lockEventId);
  const marker = `worker=${WORKER_ID};symbol=${symbol};chain=${chain.toLowerCase()}`;

  const { error: insertErr } = await supabase
    .from("webhook_logs")
    .insert({
      event_id: lockEventId,
      source: "bridge",
      event_type: "provisioning.wallet",
      status: "processing",
      signature_ok: true,
      payload_hash: payloadHash,
      attempts: 1,
      last_error: `${marker};state=started`,
      received_at: nowIso,
      queued_at: nowIso,
      completed_at: null,
    });
  if (!insertErr) return { state: "acquired", lockEventId };

  // 23505 = unique violation (event_id already exists).
  if ((insertErr as any)?.code !== "23505") {
    throw new Error(`provisioning lock insert failed: ${insertErr.message}`);
  }

  const { data: row, error: readErr } = await supabase
    .from("webhook_logs")
    .select("status, received_at, attempts")
    .eq("event_id", lockEventId)
    .maybeSingle();
  if (readErr) throw new Error(`provisioning lock read failed: ${readErr.message}`);
  const status = String(row?.status || "").toLowerCase();
  if (status === "completed") return { state: "already_completed", lockEventId };

  // If another worker currently holds this lock, don't compete.
  const receivedAt = row?.received_at ? new Date(String(row.received_at)) : new Date(0);
  const staleBefore = new Date(Date.now() - PROVISIONING_LOCK_STALE_SECONDS * 1000);
  if (status === "processing" && receivedAt > staleBefore) {
    return { state: "busy", lockEventId };
  }

  // Stale or failed lock row: takeover with CAS-like predicates.
  const staleIso = staleBefore.toISOString();
  const attempts = Number(row?.attempts || 0) + 1;
  const { data: taken, error: takeoverErr } = await supabase
    .from("webhook_logs")
    .update({
      status: "processing",
      attempts,
      last_error: `${marker};state=takeover`,
      received_at: nowIso,
      queued_at: nowIso,
      completed_at: null,
    })
    .eq("event_id", lockEventId)
    .eq("status", status || "failed")
    .lte("received_at", staleIso)
    .select("event_id")
    .maybeSingle();
  if (takeoverErr) throw new Error(`provisioning lock takeover failed: ${takeoverErr.message}`);
  if (taken?.event_id) return { state: "stale_acquired", lockEventId };
  return { state: "busy", lockEventId };
}

async function completeProvisioningLock(lockEventId: string, note: string): Promise<void> {
  await supabase
    .from("webhook_logs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      last_error: note.slice(0, 512),
    })
    .eq("event_id", lockEventId);
}

async function failProvisioningLock(lockEventId: string, errorText: string): Promise<void> {
  await supabase
    .from("webhook_logs")
    .update({
      status: "failed",
      last_error: errorText.slice(0, 512),
      completed_at: null,
    })
    .eq("event_id", lockEventId);
}

// ── Top-level router (source-aware) ──────────────────────────────────────
//
// BorderPay has one active provider path in this worker. Unknown source values
// are terminally completed without side effects (fail-closed, never fall
// through).

async function processEvent(ev: PendingEvent): Promise<void> {
  switch (ev.source) {
    case "bridge": {
      const decision = evaluateBridgeIngressEvent({
        source: "bridge",
        eventIdRaw: ev.event_id,
        eventTypeRaw: ev.event_type,
        payload: ev.payload,
        signatureOk: true,
        replayWindowOk: true,
        parseOk: true,
      });
      return await processBridgeEvent(ev, decision);
    }
    case "bridge_test":
      if (!SYNTHETIC_EVENTS_ENABLED) {
        await supabase.rpc("complete_pending_event", {
          p_event_id: ev.event_id,
          p_summary: { source: "bridge_test", skipped: "synthetic_mode_disabled" },
        });
        return;
      }
      return await processBridgeTestEvent(ev, evaluateBridgeIngressEvent({
        source: "bridge_test",
        eventIdRaw: ev.event_id,
        eventTypeRaw: ev.event_type,
        payload: ev.payload,
        signatureOk: true,
        replayWindowOk: true,
        parseOk: true,
      }));

    default:
      // Unknown source — fail closed.
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary:  { unknown_source: ev.source ?? null, event_type: ev.event_type },
      });
      return;
  }
}

// ── Bridge event router ──────────────────────────────────────────────────

async function processBridgeEvent(ev: PendingEvent, ingress: BridgeIngressDecision): Promise<void> {
  assertBridgeIngressDecision(ingress);
  if (SYNTHETIC_EVENTS_ENABLED && (ev.payload as any)?.test_origin === true) {
    const syntheticDecision = evaluateBridgeIngressEvent({
      source: "bridge_test",
      eventIdRaw: ev.event_id,
      eventTypeRaw: ev.event_type,
      payload: ev.payload,
      signatureOk: true,
      replayWindowOk: true,
      parseOk: true,
    });
    return await processBridgeTestEvent(ev, syntheticDecision);
  }

  switch (ingress.route_bucket) {
    case "bridge.kyc":
      return await handleBridgeKycKyb(ev);
    case "bridge.virtual_account":
      return await handleBridgeVirtualAccount(ev);
    case "bridge.wallet":
      return await handleBridgeWallet(ev);
    case "bridge.external_account":
      return await handleBridgeExternalAccount(ev);
    case "bridge.transfer":
      return await handleBridgeTransfer(ev);
    case "bridge.customer":
      return await handleBridgeCustomerStatus(ev);
    default:
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary:  { source: "bridge", unknown_event_type: ingress.derived_event_type, reason_code: ingress.reason_code },
      });
      return;
  }
}

// ── Synthetic Bridge-test router (dry-run only, no financial writes) ────────

function syntheticForceFail(ev: PendingEvent): boolean {
  const ctrl = (ev.payload as any)?.test_control ?? {};
  return ctrl?.force_fail === true || (ev.payload as any)?.force_fail === true;
}

function syntheticEnvelope(ev: PendingEvent): Record<string, unknown> {
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  return {
    source: "bridge_test",
    dry_run: true,
    event_type: ev.event_type,
    event_id: ev.event_id,
    replay_group_key: (ev.payload as any)?.replay_group_key ?? null,
    test_case_id: (ev.payload as any)?.test_case_id ?? null,
    bridge_event_id: (ev.payload as any)?.bridge_event_id ?? null,
    event_object_id: d?.id ?? d?.transfer_id ?? d?.wallet_id ?? d?.virtual_account_id ?? d?.external_account_id ?? null,
    customer_id: d?.customer_id ?? d?.customer?.id ?? null,
  };
}

async function processBridgeTestEvent(ev: PendingEvent, ingress: BridgeIngressDecision): Promise<void> {
  assertBridgeIngressDecision(ingress);
  if (syntheticForceFail(ev)) {
    throw new Error("synthetic_forced_failure");
  }

  const t = ingress.derived_event_type.toLowerCase();
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const base = syntheticEnvelope(ev);

  if (ingress.route_bucket === "bridge.kyc") {
    const status = String(d?.status ?? d?.kyc_status ?? ev.payload?.event_object_status ?? "").toLowerCase() || "pending";
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeKycKyb",
        intended_write_tables: ["user_profiles", "business_profiles", "bridge_webhook_events"],
        normalized_status: status,
        financial_write_blocked: true,
      },
    });
    return;
  }

  if (ingress.route_bucket === "bridge.virtual_account") {
    const isActivity = t.includes("activity") || t.includes("deposit") || t.includes("credit");
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeVirtualAccount",
        intended_write_tables: isActivity
          ? ["bridge_virtual_account_balances", "bridge_balance_ledger", "wallets", "transactions", "bridge_webhook_events"]
          : ["bridge_virtual_accounts", "bridge_webhook_events"],
        event_branch: isActivity ? "activity" : "lifecycle",
        financial_write_blocked: true,
      },
    });
    return;
  }

  if (ingress.route_bucket === "bridge.wallet") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeWallet",
        intended_write_tables: ["bridge_wallets", "bridge_webhook_events"],
        financial_write_blocked: true,
      },
    });
    return;
  }

  if (ingress.route_bucket === "bridge.external_account") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeExternalAccount",
        intended_write_tables: ["bridge_external_accounts"],
        recognized_event: t.endsWith(".created") || t.endsWith(".updated") || t.endsWith(".deleted"),
        financial_write_blocked: true,
      },
    });
    return;
  }

  if (ingress.route_bucket === "bridge.transfer") {
    const providerState = String(d?.state ?? d?.status ?? "").toLowerCase();
    const mapped = mapBridgeTransferState(providerState);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeTransfer",
        intended_write_tables: ["bridge_transfers", "transactions", "bridge_webhook_events"],
        provider_state: mapped.providerState,
        internal_state: mapped.transactionStatus,
        provider_state_recognized: mapped.recognized,
        financial_write_blocked: true,
      },
    });
    return;
  }

  if (ingress.route_bucket === "bridge.customer") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeCustomerStatus",
        intended_write_tables: ["user_profiles", "business_profiles", "bridge_webhook_events", "bridge_wallets"],
        financial_write_blocked: true,
      },
    });
    return;
  }

  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: { ...base, unknown_event_type: t, financial_write_blocked: true },
  });
}

// ── Bridge handlers ──────────────────────────────────────────────────────

async function handleBridgeKycKyb(ev: PendingEvent): Promise<void> {
  // Bridge webhook envelope is flat: { event_type, event_category,
  // event_object_id, event_object, event_object_status, ... }. The entity is
  // event_object (holds id / customer_id / status / currency / amount / etc.);
  // event_object_id is the entity's own id and event_object_status its status.
  // Fall back to a { data: ... } wrapper / bare payload for legacy/test shapes.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const customer = d?.customer_id ?? d?.customer?.id ?? d?.id ?? ev.payload?.event_object_id;
  if (!customer) throw new Error("bridge kyc/kyb event missing customer id");

  const status = String(d?.status ?? d?.kyc_status ?? ev.payload?.event_object_status ?? "").toLowerCase();
  const normalized =
    status === "approved"   || status === "verified" ? "approved"
    : status === "rejected" || status === "denied"   ? "rejected"
    : status === "under_review"                      ? "under_review"
    : status === "pending"                           ? "pending"
    : "pending";

  const isKyb = ev.event_type.toLowerCase().includes("kyb")
             || (d?.account_type === "business" || d?.type === "business");

  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(customer);
  await syncCountryFromBridgeCustomer(String(customer), {
    resolved,
    account_type: isKyb || account_type === "business" ? "business" : "individual",
  });

  if (isKyb || account_type === "business") {
    await supabase.from("business_profiles").update({
      bridge_customer_id:      String(customer),
      bridge_kyb_status:      normalized,
      bridge_kyb_completed_at: normalized === "approved" ? new Date().toISOString() : null,
      updated_at:             new Date().toISOString(),
    }).eq("user_id", resolved);
    await supabase.from("user_profiles").update({
      bridge_customer_id: String(customer),
      kyc_status:         normalized === "approved" ? "verified" : normalized === "rejected" ? "rejected" : "pending",
      updated_at:         new Date().toISOString(),
    }).eq("id", resolved);
  } else {
    await supabase.from("user_profiles").update({
      bridge_kyc_status:        normalized,
      bridge_kyc_completed_at:  normalized === "approved" ? new Date().toISOString() : null,
      kyc_status:               normalized === "approved" ? "verified" : normalized === "rejected" ? "rejected" : "pending",
      updated_at:               new Date().toISOString(),
    }).eq("id", resolved);
  }

  // Product requirement: auto-provision stablecoin wallets after approval.
  // Any failure must surface so the queue retries safely with idempotent keys.
  if (normalized === "approved") {
    const approvedAccountType = isKyb || account_type === "business" ? "business" : "individual";
    await ensureStablecoinWalletsProvisioned({
      userId: resolved,
      bridgeCustomerId: String(customer),
      accountType: approvedAccountType,
    });
    await emailVirtualAccountLimitsBestEffort({
      userId: resolved,
      bridgeCustomerId: String(customer),
      accountType: approvedAccountType,
    });
    await supabase.rpc("apply_card_waitlist_referral_approval", {
      p_event_id: ev.event_id,
      p_referred_id: resolved,
      p_spots: 500,
      p_metadata: {
        source: "bridge",
        kind: isKyb ? "kyb" : "kyc",
        bridge_customer_id: String(customer),
        bridge_status: normalized,
      },
    });
  }

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: isKyb ? "kyc_link" : "customer", target_entity_id: String(customer) })
    .eq("event_id", ev.event_id);

  // Terminal KYC/KYB decision → best-effort email (approved/rejected only).
  if (normalized === "approved" || normalized === "rejected") {
    await emailKycDecisionBestEffort(resolved, isKyb || account_type === "business", normalized);
    if (normalized === "approved") {
      await emailAccountMaintenanceFeeBestEffort(
        resolved,
        isKyb || account_type === "business" ? "business" : "individual",
      );
    }
  }

  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  { source: "bridge", kind: isKyb ? "kyb" : "kyc", status: normalized },
  });
}

async function handleBridgeCustomerStatus(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the customer; event_object_id is the
  // customer id; event_object_status its status. (See handleBridgeKycKyb.)
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const customer = d?.customer_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!customer) throw new Error("bridge customer event missing id");

  const accountStatus = String(d?.status ?? d?.account_status ?? ev.payload?.event_object_status ?? "").toLowerCase();
  if (accountStatus) {
    const { data: previousProfile, error: previousProfileError } = await supabase
      .from("user_profiles")
      .select("id,account_type,bridge_account_status")
      .eq("bridge_customer_id", String(customer))
      .maybeSingle();
    if (previousProfileError) throw new Error(`bridge customer previous status lookup failed: ${previousProfileError.message}`);
    if (!previousProfile) throw new Error(`bridge customer profile not found: ${String(customer)}`);
    const previousAccountStatus = String(previousProfile?.bridge_account_status || "").trim().toLowerCase();

    // #53 item 4 — terminal-status propagation into canonical kyc_status.
    // Bridge customer terminal states (confirmed from our webhook data):
    //   active   = KYC passed  -> canonical kyc_status 'verified'
    //   rejected = KYC failed   -> canonical kyc_status 'rejected'
    // NON-terminal states (not_started / incomplete / pending / under_review)
    // must NOT move canonical kyc_status — only mirror bridge_account_status, as
    // before. This deliberately fires ONLY on a terminal customer status, never
    // on every customer.updated. Business KYB is handled by handleBridgeKycKyb
    // (this individual-customer path updates user_profiles only). No email here.
    const canonicalKyc =
      accountStatus === "active"   ? "verified"
      : accountStatus === "rejected" ? "rejected"
      : null; // non-terminal → leave canonical kyc_status untouched

    const update: Record<string, unknown> = {
      bridge_account_status: accountStatus,
      bridge_verification_status: accountStatus || null,
      updated_at:            new Date().toISOString(),
    };
    // Provider restrictions immediately become a canonical local freeze. Never
    // auto-unfreeze here: another compliance source may still require the hold.
    const restrictedAccountStatuses = new Set([
      "frozen", "paused", "risk_paused", "restricted", "blocked", "suspended",
      "offboarded", "closed", "terminated", "deactivated", "rejected",
    ]);
    if (restrictedAccountStatuses.has(accountStatus.replace(/[\s-]+/g, "_"))) {
      update.account_status = "frozen";
    }
    const pausedAt = String(ev.payload?.event_created_at ?? d?.updated_at ?? new Date().toISOString());
    update.bridge_account_paused_at = accountStatus === "paused" ? pausedAt : null;
    if (canonicalKyc) update.kyc_status = canonicalKyc;

    // Persist the customer's contact details Bridge sends on the customer event
    // (phone + residential address) so Profile → Personal information is filled,
    // not empty. Only overwrite when Bridge actually provides a value.
    const addr: any = d?.residential_address ?? d?.address ?? {};
    const phone = d?.phone ?? d?.phone_number;
    if (phone) update.phone = String(phone);
    const street = addr?.street_line_1 ?? addr?.street_line1 ?? addr?.line1 ?? addr?.street ?? "";
    const street2 = addr?.street_line_2 ?? addr?.street_line2 ?? "";
    const normalizedAddress = {
      street_line_1: street || null,
      street_line_2: street2 || null,
      city: addr?.city ? String(addr.city) : null,
      state: addr?.state ? String(addr.state) : null,
      postal_code: (addr?.postal_code ?? addr?.postcode ?? addr?.zip) ? String(addr?.postal_code ?? addr?.postcode ?? addr?.zip) : null,
      country: (addr?.country ?? d?.country) ? String(addr?.country ?? d?.country) : null,
    };
    if (Object.values(normalizedAddress).some((v) => v !== null && String(v).trim().length > 0)) {
      update.bridge_address_object = normalizedAddress;
    }
    if (street) update.address = street2 ? `${street}, ${street2}` : String(street);
    if (addr?.city) update.city = String(addr.city);
    const postal = addr?.postal_code ?? addr?.postcode ?? addr?.zip;
    if (postal) update.postal_code = String(postal);
    const country = addr?.country ?? d?.country;
    if (country) update.country = String(country);

    const { error: profileUpdateError } = await supabase.from("user_profiles")
      .update(update)
      .eq("bridge_customer_id", String(customer));
    if (profileUpdateError) throw new Error(`bridge customer status update failed: ${profileUpdateError.message}`);

    if (accountStatus === "paused" && previousAccountStatus !== "paused") {
      try {
        const owner = await resolveOwnerFromBridgeCustomer(String(customer));
        await emailAccountPausedBestEffort(
          owner.resolved,
          owner.account_type,
          String(customer),
          pausedAt,
        );
      } catch {
        // Best-effort notification must never fail webhook reconciliation.
      }
    }

    try {
      const owner = await resolveOwnerFromBridgeCustomer(String(customer));
      await syncCountryFromBridgeCustomer(String(customer), owner);
    } catch {
      // Keep customer status processing resilient; owner mapping is handled by queue retries.
    }

    // Terminal customer KYC decision → best-effort email. Individual only;
    // business KYB decisions are emailed from handleBridgeKycKyb. active→approved,
    // rejected→rejected (uses the v13 terminal mapping above).
    if (canonicalKyc === "verified" || canonicalKyc === "rejected") {
      try {
        const owner = await resolveOwnerFromBridgeCustomer(String(customer));
        if (owner.account_type === "individual") {
          await emailKycDecisionBestEffort(
            owner.resolved, false,
            canonicalKyc === "verified" ? "approved" : "rejected",
          );
          if (canonicalKyc === "verified") {
            await emailAccountMaintenanceFeeBestEffort(owner.resolved, "individual");
          }
        }
      } catch { /* best-effort: never fail the webhook on email */ }
    }

    if (canonicalKyc === "verified") {
      const owner = await resolveOwnerFromBridgeCustomer(String(customer));
      await ensureStablecoinWalletsProvisioned({
        userId: owner.resolved,
        bridgeCustomerId: String(customer),
        accountType: owner.account_type,
      });
      await supabase.rpc("apply_card_waitlist_referral_approval", {
        p_event_id: ev.event_id,
        p_referred_id: owner.resolved,
        p_spots: 500,
        p_metadata: {
          source: "bridge",
          kind: "customer",
          bridge_customer_id: String(customer),
          bridge_status: accountStatus,
        },
      });
    }
  }
  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: "customer", target_entity_id: String(customer) })
    .eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  { source: "bridge", kind: "customer", status: accountStatus },
  });
}

// Currency scale map. Minor-unit math is integer-only; no float drift.
// Stablecoins are intentionally absent — wallet credit lives in a separate
// chunk (drift #3 covers VA fiat; stablecoin balance is future work).
const CURRENCY_SCALE: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
  USDB: 6,
  EURC: 6,
};
const FIAT_VA_CURRENCIES = new Set(["USD", "EUR", "GBP"]);
const BRIDGE_SETTLEMENT_ASSET_CURRENCIES = new Set(["USDC", "USDT", "PYUSD", "USDB", "EURC"]);
const DEFAULT_VA_DEVELOPER_FEE_PERCENT_BY_ACCOUNT: Record<"individual" | "business", number> = {
  individual: 2.5,
  business: 2.0,
};
const BRIDGE_COUNTRY_CODE_RE = /^[A-Z]{2}$/;

function normalizeCountryCode(value: unknown): string | null {
  const s = String(value ?? "").trim().toUpperCase();
  return BRIDGE_COUNTRY_CODE_RE.test(s) ? s : null;
}

/**
 * Convert a Bridge amount (number or decimal string) into bigint minor units.
 * Returns null for unsupported currency or malformed input. Pure integer math.
 */
function toMinorUnits(amount: unknown, currency: string): bigint | null {
  const scale = CURRENCY_SCALE[currency.toUpperCase()];
  if (scale === undefined) return null;
  const raw = typeof amount === "string" ? amount.trim()
            : typeof amount === "number" ? (Number.isFinite(amount) ? amount.toString() : "")
            : "";
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const abs      = negative ? raw.slice(1) : raw;
  const [intPart, fracPart = ""] = abs.split(".");
  const padded = (fracPart + "0".repeat(scale)).slice(0, scale);
  const minor  = BigInt(intPart) * (10n ** BigInt(scale)) + BigInt(padded || "0");
  return negative ? -minor : minor;
}

function formatMinorUnits(amountMinor: bigint, currency: string): string {
  const scale = CURRENCY_SCALE[currency.toUpperCase()] ?? 2;
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = abs % base;
  const numeric = Number(`${negative ? "-" : ""}${whole}.${frac.toString().padStart(scale, "0")}`);
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: Math.min(scale, 6) })} ${currency.toUpperCase()}`;
}

function minorToDecimal(amountMinor: bigint, currency: string): number {
  return Number(amountMinor) / 10 ** (CURRENCY_SCALE[currency.toUpperCase()] ?? 2);
}

function absMinor(amountMinor: bigint): bigint {
  return amountMinor < 0n ? -amountMinor : amountMinor;
}

function normalizeBridgeEndpointType(value: unknown): "virtual_account" | "wallet" | "external_bank" | "external_wallet" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "bridge_wallet" || raw === "wallet") return "wallet";
  if (raw === "virtual_account" || raw === "virtual_account_bank" || raw === "payment_route") return "virtual_account";
  if (raw === "external_wallet" || raw === "crypto" || raw === "blockchain") return "external_wallet";
  if (raw === "external_bank" || raw === "ach" || raw === "wire" || raw === "sepa" || raw === "faster_payments") return "external_bank";
  return "external_bank";
}

function bridgeTransferDirection(
  sourceType: "virtual_account" | "wallet" | "external_bank" | "external_wallet",
  destinationType: "virtual_account" | "wallet" | "external_bank" | "external_wallet",
): "credit" | "debit" {
  if (sourceType === "wallet") return "debit";
  if (destinationType === "wallet") return "credit";
  if (sourceType === "virtual_account" || sourceType === "external_bank") return "credit";
  return "debit";
}

function inferWalletActivityDirection(eventType: string, payload: any, amountMinor: bigint | null): "credit" | "debit" {
  if (amountMinor !== null && amountMinor < 0n) return "debit";
  const sourceRail = normalizeBridgeEndpointType(
    payload?.source?.payment_rail ??
    payload?.source?.type ??
    payload?.source_payment_rail ??
    payload?.source_type,
  );
  const destinationRail = normalizeBridgeEndpointType(
    payload?.destination?.payment_rail ??
    payload?.destination?.type ??
    payload?.destination_payment_rail ??
    payload?.destination_type,
  );
  if (sourceRail === "wallet") return "debit";
  if (destinationRail === "wallet") return "credit";
  const markers = [
    eventType,
    payload?.type,
    payload?.kind,
    payload?.direction,
    payload?.side,
    payload?.category,
    payload?.transaction_type,
    payload?.description,
    payload?.memo,
  ].map((v) => String(v ?? "").toLowerCase()).join(" ");
  if (/\b(debit|withdraw|withdrawal|sent|send|payout|transfer_out|outbound)\b/.test(markers)) return "debit";
  if (/\b(credit|deposit|received|receive|collection|transfer_in|inbound)\b/.test(markers)) return "credit";
  return "credit";
}

function bridgeTransferIdFromPayload(payload: any): string | null {
  const candidates = [
    payload?.bridge_transfer_id,
    payload?.transfer_id,
    payload?.transfer?.id,
    payload?.source?.transfer_id,
    payload?.destination?.transfer_id,
    payload?.metadata?.bridge_transfer_id,
    payload?.metadata?.transfer_id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return null;
}

function firstMinorUnitAmount(payload: any, currency: string, keys: string[]): bigint {
  for (const key of keys) {
    const raw = payload?.[key];
    const direct = toMinorUnits(raw, currency);
    if (direct !== null) return direct < 0n ? -direct : direct;
    if (raw && typeof raw === "object") {
      const nested = toMinorUnits(raw.amount, currency);
      if (nested !== null) return nested < 0n ? -nested : nested;
    }
  }
  return 0n;
}

function firstNonEmptyText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = firstFiniteNumber((value as Record<string, unknown>).amount);
      if (nested !== null) return nested;
      continue;
    }
    const text = String(value ?? "").replace(/,/g, "").trim();
    if (!text) continue;
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function maskAddress(value: string | null): string | null {
  const text = String(value || "").trim();
  if (text.length <= 12) return text || null;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function bridgeReceiptId(payload: any, vaId: unknown): string | null {
  const rawId = firstNonEmptyText(payload?.id);
  return firstNonEmptyText(
    payload?.deposit_id,
    payload?.receipt?.deposit_id,
    payload?.receipt?.id,
    payload?.deposit?.id,
    rawId && rawId !== String(vaId) ? rawId : null,
    payload?.reference,
    payload?.source?.tracking_number,
  );
}

function normalizeCurrencyCode(value: unknown): string | null {
  const text = String(value ?? "").trim().toUpperCase();
  return CURRENCY_SCALE[text] !== undefined ? text : null;
}

function bridgeVirtualAccountSourceCurrency(payload: any, existingAccountDetails: unknown, existingCurrency: unknown): string {
  const details = objectValue(existingAccountDetails) ?? {};
  const payloadDetails = objectValue(payload?.account_details) ?? {};
  return normalizeCurrencyCode(payload?.source_deposit_instructions?.currency) ??
    normalizeCurrencyCode(objectValue(payloadDetails.source_deposit_instructions)?.currency) ??
    normalizeCurrencyCode(objectValue(details.source_deposit_instructions)?.currency) ??
    normalizeCurrencyCode(existingCurrency) ??
    normalizeCurrencyCode(payload?.currency) ??
    "USD";
}

function isConvertedVirtualAccountSettlementEvent(activityType: string, sourceCurrency: string, eventCurrency: string): boolean {
  return FIAT_VA_CURRENCIES.has(sourceCurrency) &&
    BRIDGE_SETTLEMENT_ASSET_CURRENCIES.has(eventCurrency) &&
    ["payment_submitted", "payment_processed", "processed", "succeeded", "success"].includes(activityType);
}

function isFiatVirtualAccountCreditEvent(activityType: string, sourceCurrency: string, eventCurrency: string): boolean {
  return FIAT_VA_CURRENCIES.has(sourceCurrency) &&
    eventCurrency === sourceCurrency &&
    ["funds_received", "payment_received", "credit_received"].includes(activityType);
}

function receivedAmountBreakdown(payload: any, currency: string): {
  grossMinor: bigint;
  developerFeeMinor: bigint;
  exchangeFeeMinor: bigint;
  netMinor: bigint;
} | null {
  const grossMinor = toMinorUnits(payload?.amount, currency);
  if (grossMinor === null) return null;

  const developerFeeMinor = firstMinorUnitAmount(payload, currency, [
    "developer_fee_amount",
    "developerFeeAmount",
    "developer_fee",
    "developerFee",
  ]);
  const exchangeFeeMinor = firstMinorUnitAmount(payload, currency, [
    "exchange_fee_amount",
    "exchangeFeeAmount",
    "exchange_fee",
    "exchangeFee",
  ]);
  const netMinor = grossMinor - developerFeeMinor - exchangeFeeMinor;

  return {
    grossMinor,
    developerFeeMinor,
    exchangeFeeMinor,
    netMinor: netMinor > 0n ? netMinor : 0n,
  };
}

function bridgeVaReceiptDetails(params: {
  payload: any;
  sourceCurrency: string;
  vaId: unknown;
  accountDetails: Record<string, unknown>;
  breakdown: ReturnType<typeof receivedAmountBreakdown>;
}): Record<string, unknown> {
  const p = params.payload || {};
  const receipt = objectValue(p.receipt) ?? {};
  const destination =
    objectValue(p.destination) ??
    objectValue(receipt.destination) ??
    objectValue(params.accountDetails.destination) ??
    objectValue(objectValue(p.account_details)?.destination) ??
    {};
  const sourceInstructions =
    objectValue(p.source_deposit_instructions) ??
    objectValue(params.accountDetails.source_deposit_instructions) ??
    objectValue(objectValue(p.account_details)?.source_deposit_instructions) ??
    {};
  const sourceCurrency = params.sourceCurrency.toUpperCase();
  const destinationCurrency = firstNonEmptyText(
    receipt.destination_currency,
    receipt.outgoing_currency,
    p.destination_currency,
    p.to_currency,
    destination.currency,
    destination.asset,
  )?.toUpperCase() ?? null;
  const destinationAmount = firstFiniteNumber(
    receipt.destination_amount,
    receipt.outgoing_amount,
    receipt.final_destination_amount,
    p.destination_amount,
    p.outgoing_amount,
    p.final_destination_amount,
    p.net_destination_amount,
    destination.amount,
  );
  const destinationAddress = firstNonEmptyText(
    receipt.destination_address,
    p.destination_address,
    destination.address,
    destination.to_address,
  );
  const exchangeRate = firstFiniteNumber(
    receipt.exchange_rate,
    receipt.rate,
    p.exchange_rate,
    p.conversion_rate,
    p.rate,
  );
  const breakdown = params.breakdown;
  return {
    deposit_id: bridgeReceiptId(p, params.vaId),
    source_currency: sourceCurrency,
    source_amount: breakdown ? minorToDecimal(breakdown.grossMinor, sourceCurrency) : firstFiniteNumber(receipt.initial_amount, p.initial_amount, p.amount),
    service_charge_amount: breakdown ? minorToDecimal(breakdown.developerFeeMinor, sourceCurrency) : firstFiniteNumber(receipt.developer_fee_amount, receipt.developer_fee, p.developer_fee_amount, p.developer_fee),
    available_amount: breakdown ? minorToDecimal(breakdown.netMinor, sourceCurrency) : firstFiniteNumber(receipt.final_amount, receipt.net_amount, p.final_amount, p.net_amount),
    destination_currency: destinationCurrency,
    destination_amount: destinationAmount,
    exchange_rate: exchangeRate,
    destination_address: maskAddress(destinationAddress),
    source_rail: firstNonEmptyText(receipt.source_rail, p.source_rail, sourceInstructions.payment_rail, sourceInstructions.rail),
  };
}

function humanizeRail(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.length <= 4 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function bridgeVaRefundDetails(payload: any): Record<string, unknown> {
  const p = payload || {};
  const refund = objectValue(p.refund) ?? {};
  const source = objectValue(p.source) ?? {};
  return {
    return_reason: firstNonEmptyText(refund.reason, p.return_reason, p.reason),
    returned_at: firstNonEmptyText(refund.refunded_at, refund.returned_at, p.returned_at, p.created_at),
    risk_rejection_reason: firstNonEmptyText(refund.risk_rejection_reason, p.risk_rejection_reason),
    refund_rail: humanizeRail(firstNonEmptyText(refund.rail, refund.refund_rail, source.payment_rail, source.payment_scheme)),
    refund_beneficiary_name: firstNonEmptyText(refund.beneficiary_name, refund.refund_beneficiary_name, source.sender_name, source.originator_name),
    refund_reference_id: firstNonEmptyText(refund.refund_reference_id, refund.reference_id, refund.tracking_number, p.refund_reference_id),
  };
}

function transferReceiptBreakdown(payload: any, currency: string): {
  grossMinor: bigint;
  developerFeeMinor: bigint;
  exchangeFeeMinor: bigint;
  netMinor: bigint;
} | null {
  const receipt = payload?.receipt && typeof payload.receipt === "object" ? payload.receipt : {};
  const grossMinor =
    toMinorUnits(receipt?.initial_amount, currency) ??
    toMinorUnits(receipt?.amount, currency) ??
    toMinorUnits(payload?.initial_amount, currency) ??
    toMinorUnits(payload?.amount, currency);
  if (grossMinor === null) return null;

  const developerFeeMinor = firstMinorUnitAmount(receipt, currency, [
    "developer_fee_amount",
    "developer_fee",
  ]) || firstMinorUnitAmount(payload, currency, [
    "developer_fee_amount",
    "developer_fee",
  ]);
  const exchangeFeeMinor = firstMinorUnitAmount(receipt, currency, [
    "exchange_fee_amount",
    "exchange_fee",
  ]) || firstMinorUnitAmount(payload, currency, [
    "exchange_fee_amount",
    "exchange_fee",
  ]);
  const explicitFinalMinor =
    toMinorUnits(receipt?.final_amount, currency) ??
    toMinorUnits(receipt?.net_amount, currency) ??
    toMinorUnits(payload?.final_amount, currency) ??
    toMinorUnits(payload?.net_amount, currency) ??
    toMinorUnits(payload?.net_destination_amount, currency);
  const netMinor = explicitFinalMinor ?? (grossMinor - developerFeeMinor - exchangeFeeMinor);

  return {
    grossMinor,
    developerFeeMinor,
    exchangeFeeMinor,
    netMinor: netMinor > 0n ? netMinor : 0n,
  };
}

function normalizeTransactionEmailStatus(raw: string): TransactionEmailStatus | null {
  const s = raw.trim().toLowerCase();
  if (["in_review", "under_review", "review", "pending_review", "manual_review"].includes(s)) return "in_review";
  if (["approved", "completed", "complete", "payment_processed", "processed", "succeeded", "success"].includes(s)) return "approved";
  if (["canceled", "cancelled", "cancelled_by_customer", "canceled_by_customer"].includes(s)) return "canceled";
  if (["refund_in_flight", "refund_pending", "return_in_flight"].includes(s)) return "refund_in_flight";
  if (["refunded", "returned", "refund_complete", "refund_completed"].includes(s)) return "refunded";
  return null;
}

function transactionStatusTitle(status: TransactionEmailStatus): string {
  switch (status) {
    case "in_review": return "Transaction under review";
    case "approved": return "Transaction approved";
    case "canceled": return "Transaction canceled";
    case "refund_in_flight": return "Refund in progress";
    case "refunded": return "Transaction refunded";
  }
}

function decimalAmountLabel(value: unknown, currency: unknown): string | null {
  const c = String(currency ?? "").toUpperCase();
  const n = Number(value);
  if (!c || !Number.isFinite(n)) return null;
  const minor = toMinorUnits(String(n), c);
  return minor === null ? `${n} ${c}` : formatMinorUnits(minor, c);
}

function transactionStatusBody(status: TransactionEmailStatus, amountLabel: string, metadata?: Record<string, unknown>): string {
  const currency = metadata?.currency;
  const grossLabel = decimalAmountLabel(metadata?.gross_amount, currency);
  const transactionFeeLabel = decimalAmountLabel(metadata?.developer_fee_amount, currency);
  const exchangeFeeLabel = decimalAmountLabel(metadata?.exchange_fee_amount, currency);
  const hasFeeBreakdown = Boolean(
    grossLabel &&
    ((Number(metadata?.developer_fee_amount ?? 0) > 0) || (Number(metadata?.exchange_fee_amount ?? 0) > 0)),
  );
  const receiptPrefix = hasFeeBreakdown
    ? `Full amount received: ${grossLabel}. ${transactionFeeLabel ? `Transaction fee: -${transactionFeeLabel}. ` : ""}${exchangeFeeLabel ? `Exchange fee: -${exchangeFeeLabel}. ` : ""}Net amount: ${amountLabel}. `
    : "";
  switch (status) {
    case "in_review":
      return `${receiptPrefix || `${amountLabel} transaction `}${receiptPrefix ? "This transaction is" : "is"} under compliance review. We will notify you when the status changes.`;
    case "approved":
      return `${receiptPrefix || `${amountLabel} transaction `}${receiptPrefix ? "This transaction has" : "has"} been approved.`;
    case "canceled":
      return `${receiptPrefix || `${amountLabel} transaction `}${receiptPrefix ? "This transaction was" : "was"} canceled. No funds were made available.`;
    case "refund_in_flight":
      return `${receiptPrefix || `${amountLabel} refund `}${receiptPrefix ? "Refund is" : "is"} in progress. We will notify you when it is complete.`;
    case "refunded":
      return `${receiptPrefix || `${amountLabel} transaction `}${receiptPrefix ? "This transaction was" : "was"} refunded. Funds are no longer available.`;
  }
}

async function insertTransactionStatusNotification(params: {
  userId: string;
  status: TransactionEmailStatus;
  amountLabel: string;
  metadata: Record<string, unknown>;
  idempotencyMatch: Record<string, unknown>;
}): Promise<boolean> {
  const { data: existingNotification } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", params.userId)
    .eq("type", "transaction")
    .contains("metadata", params.idempotencyMatch)
    .maybeSingle();
  if (existingNotification?.id) return false;
  await supabase.from("notifications").insert({
    user_id: params.userId,
    type: "transaction",
    title: transactionStatusTitle(params.status),
    body: transactionStatusBody(params.status, params.amountLabel, params.metadata),
    metadata: params.metadata,
  });
  return true;
}

function publicTransactionStatus(status: TransactionEmailStatus): "completed" | "pending" | "failed" {
  if (status === "approved") return "completed";
  if (status === "in_review" || status === "refund_in_flight") return "pending";
  return "failed";
}

function transactionStatusDescription(status: TransactionEmailStatus): string {
  switch (status) {
    case "in_review": return "Deposit under compliance review";
    case "approved": return "Deposit approved";
    case "canceled": return "Deposit canceled";
    case "refund_in_flight": return "Deposit refund in progress";
    case "refunded": return "Deposit refunded";
  }
}

async function upsertVirtualAccountStatusTransaction(params: {
  userId: string;
  accountType: AccountType;
  status: TransactionEmailStatus;
  amount: number;
  currency: string;
  reference: string;
  description: string;
  metadata: Record<string, unknown>;
  occurredAt?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .upsert({
      user_id: params.userId,
      type: "deposit",
      amount: params.amount,
      currency: params.currency,
      status: publicTransactionStatus(params.status),
      reference: params.reference,
      description: params.description,
      metadata: {
        ...params.metadata,
        account_type: params.accountType,
        direction: "credit",
        transaction_type: "virtual_account_deposit",
      },
      provider: "bridge",
      created_at: params.occurredAt ?? new Date().toISOString(),
    }, { onConflict: "reference" });
  if (error) throw new Error(`upsert VA status transaction failed: ${error.message}`);
}

function normalizeDeveloperFeePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

function normalizeBridgeVirtualAccountRail(value: unknown): string | null {
  const rail = String(value ?? "").trim().toLowerCase();
  if (!rail) return null;
  if (rail === "ach") return "ach_push";
  if (["ach_push", "ach_pull", "wire", "sepa", "faster_payments"].includes(rail)) return rail;
  return null;
}

function normalizeBridgeVirtualAccountStatus(value: unknown): "active" | "suspended" | "closed" {
  const status = String(value ?? "").trim().toLowerCase();
  if (["closed", "deleted", "disabled", "deactivated", "inactive"].includes(status)) return "closed";
  if (["suspended", "paused"].includes(status)) return "suspended";
  return "active";
}

function normalizedText(value: unknown): string {
  return String(value ?? "").trim();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function resolvesToSavedExternalWallet(params: {
  userId: string;
  accountDetails: Record<string, unknown>;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const destination =
    objectValue(params.accountDetails.destination) ??
    objectValue(params.payload.destination) ??
    objectValue(objectValue(params.payload.account_details)?.destination);
  if (!destination) return false;

  const markedSource = normalizedText(destination.source).toLowerCase();
  if (markedSource === "external_wallet") return true;
  if (normalizedText(destination.external_wallet_id)) return true;

  const address = normalizedText(destination.address).toLowerCase();
  const asset = normalizedText(destination.currency).toUpperCase();
  const chain = normalizedText(destination.payment_rail || destination.chain).toLowerCase();
  if (!address || !asset || !chain) return false;

  const { data } = await supabase
    .from("external_wallets")
    .select("id,address")
    .eq("user_id", params.userId)
    .ilike("asset", asset)
    .ilike("chain", chain)
    .eq("status", "active")
    .limit(20);
  return (data || []).some((row: Record<string, unknown>) =>
    normalizedText(row?.address).toLowerCase() === address
  );
}

const cachedCanonicalVaDeveloperFeePercentByAccount: Partial<Record<"individual" | "business", number>> = {};
async function getCanonicalVaDeveloperFeePercent(accountType: "individual" | "business"): Promise<number> {
  if (cachedCanonicalVaDeveloperFeePercentByAccount[accountType] !== undefined) {
    return cachedCanonicalVaDeveloperFeePercentByAccount[accountType]!;
  }
  const settingKey = accountType === "business"
    ? "bridge.virtual_account.business.developer_fee_percent"
    : "bridge.virtual_account.individual.developer_fee_percent";
  const { data: typedSetting } = await supabase
    .from("provider_settings")
    .select("value")
    .eq("key", settingKey)
    .maybeSingle();
  const { data: setting } = await supabase
    .from("provider_settings")
    .select("value")
    .eq("key", "bridge.virtual_account.developer_fee_percent")
    .maybeSingle();
  const fee =
    normalizeDeveloperFeePercent(typedSetting?.value) ??
    normalizeDeveloperFeePercent(setting?.value) ??
    DEFAULT_VA_DEVELOPER_FEE_PERCENT_BY_ACCOUNT[accountType];
  cachedCanonicalVaDeveloperFeePercentByAccount[accountType] = fee;
  return fee;
}

async function upsertBridgeVirtualAccountProjection(params: {
  vaId: string;
  customer: string;
  payload: any;
  currency: string;
  existingFeePercent?: unknown;
  existingAccountDetails?: unknown;
}) {
  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(params.customer);
  const canonicalFee = await getCanonicalVaDeveloperFeePercent(account_type);
  const payloadFee =
    normalizeDeveloperFeePercent(params.payload?.developer_fee_percent) ??
    normalizeDeveloperFeePercent(params.payload?.virtual_account?.developer_fee_percent);
  const effectiveFee =
    payloadFee ??
    normalizeDeveloperFeePercent(params.existingFeePercent) ??
    canonicalFee;
  const status = normalizeBridgeVirtualAccountStatus(params.payload?.status);
  const existingDetails = params.existingAccountDetails && typeof params.existingAccountDetails === "object"
    ? params.existingAccountDetails as Record<string, unknown>
    : {};
  const payloadDetails = params.payload && typeof params.payload === "object"
    ? params.payload as Record<string, unknown>
    : {};
  const destinationDetails =
    existingDetails.destination && typeof existingDetails.destination === "object"
      ? existingDetails.destination
      : payloadDetails.destination && typeof payloadDetails.destination === "object"
        ? payloadDetails.destination
        : null;
  const destinationSource = destinationDetails && typeof destinationDetails === "object"
    ? String((destinationDetails as Record<string, unknown>).source || "").trim().toLowerCase()
    : "";
  const mergedAccountDetails = {
    ...existingDetails,
    ...payloadDetails,
    ...(destinationDetails ? { destination: destinationDetails } : {}),
    source_deposit_instructions:
      params.payload?.source_deposit_instructions ??
      params.payload?.account_details?.source_deposit_instructions ??
      existingDetails.source_deposit_instructions ??
      null,
  };

  await supabase.from("bridge_virtual_accounts").upsert({
    bridge_virtual_account_id: String(params.vaId),
    bridge_customer_id:        String(params.customer),
    user_id:                   account_type === "individual" ? resolved : null,
    business_user_id:          account_type === "business"   ? resolved : null,
    currency:                  params.currency,
    rail:                      normalizeBridgeVirtualAccountRail(
      params.payload?.source_deposit_instructions?.payment_rail ??
      params.payload?.rail ??
      params.payload?.payment_rail,
    ),
    account_details:           mergedAccountDetails,
    status,
    developer_fee_percent:     effectiveFee,
    updated_at:                new Date().toISOString(),
  }, { onConflict: "bridge_virtual_account_id" });

  if (status === "active") {
    await supabase.from("pending_va_requests")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_note: `Resolved by Bridge virtual account ${params.vaId}.`,
      })
      .eq(account_type === "business" ? "bridge_customer_id" : "user_id", account_type === "business" ? String(params.customer) : resolved)
      .eq("currency", params.currency)
      .eq("status", "pending");
  }

  const inferredExternalDestination = await resolvesToSavedExternalWallet({
    userId: resolved,
    accountDetails: mergedAccountDetails,
    payload: payloadDetails,
  });

  return {
    resolved,
    account_type,
    developer_fee_percent: effectiveFee,
    status,
    destination_source: inferredExternalDestination ? "external_wallet" : destinationSource,
  };
}

async function handleBridgeVirtualAccount(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the virtual_account; event_object_id its id.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const vaId   = d?.virtual_account_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!vaId) throw new Error("bridge virtual_account event missing virtual_account_id");

  const payloadCustomer = d?.customer_id ?? d?.customer?.id;
  const { data: existingVa } = await supabase
    .from("bridge_virtual_accounts")
    .select("bridge_customer_id,developer_fee_percent,account_details,currency")
    .eq("bridge_virtual_account_id", String(vaId))
    .maybeSingle();
  const customer = payloadCustomer ?? existingVa?.bridge_customer_id;
  if (!customer) throw new Error("bridge virtual_account event missing customer_id and VA mapping");

  const t = ev.event_type.toLowerCase();
  const isActivity =
    t.includes("activity") ||
    t.includes("deposit") ||
    t.includes("credit") ||
    t.includes("debit") ||
    t.includes("withdraw") ||
    t.includes("transfer");
  const currency = bridgeVirtualAccountSourceCurrency(d, existingVa?.account_details, existingVa?.currency);
  const eventCurrency = normalizeCurrencyCode(d?.currency) ?? currency;
  const owner = await upsertBridgeVirtualAccountProjection({
    vaId: String(vaId),
    customer: String(customer),
    payload: d,
    currency,
    existingFeePercent: existingVa?.developer_fee_percent,
    existingAccountDetails: existingVa?.account_details,
  });
  const deliversToExternalWallet = owner.destination_source === "external_wallet";
  const accountDetails = objectValue(existingVa?.account_details) ?? {};

  // Lifecycle event (created/updated/etc): projection already upserted above.
  if (!isActivity) {
    const { resolved, account_type } = owner;
    if (owner.status !== "active") {
      await supabase.from("bridge_webhook_events")
        .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
        .eq("event_id", ev.event_id);
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary:  { source: "bridge", kind: "virtual_account", virtual_account_id: vaId, status: owner.status, notified: false },
      });
      return;
    }
    const notificationMatch = {
      kind: "global_account_ready",
      virtual_account_id: String(vaId),
      currency,
    };
    const { data: existingNotification } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", resolved)
      .eq("type", "account")
      .contains("metadata", notificationMatch)
      .maybeSingle();
    if (!existingNotification?.id) {
      await supabase.from("notifications").insert({
        user_id: resolved,
        type: "account",
        title: `${currency} global account active`,
        body: `Your ${currency} global account is active and ready to receive payments.`,
        metadata: {
          ...notificationMatch,
          source: "bridge",
          bridge_event_id: ev.event_id,
        },
      });
    }
    await emailGlobalAccountReadyBestEffort({
      userId: resolved,
      accountType: account_type,
      currency,
      virtualAccountId: String(vaId),
    });

    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  { source: "bridge", kind: "virtual_account", virtual_account_id: vaId, notified: true },
    });
    return;
  }

  // Activity / deposit / credit event.
  const activityType = String(d?.status ?? d?.type ?? "").trim().toLowerCase();
  const nonCreditStatus = normalizeTransactionEmailStatus(activityType);
  if (nonCreditStatus && nonCreditStatus !== "approved") {
    const depositId = String(d?.deposit_id ?? "").trim();
    const statusBreakdown = receivedAmountBreakdown(d, currency);
    const statusReceipt = bridgeVaReceiptDetails({
      payload: d,
      sourceCurrency: currency,
      vaId,
      accountDetails,
      breakdown: statusBreakdown,
    });
    const refundDetails = bridgeVaRefundDetails(d);
    const receiptDepositId = String(statusReceipt.deposit_id || depositId || "").trim();
    const statusAmountMinor = statusBreakdown?.netMinor ?? toMinorUnits(d?.amount, currency);
    const amountLabel = statusAmountMinor == null
      ? `${String(d?.amount ?? "").trim() || "Your"} ${currency}`.trim()
      : formatMinorUnits(statusAmountMinor, currency);
    let reversal: Record<string, unknown> | null = null;
    if (!deliversToExternalWallet && (nonCreditStatus === "refunded" || nonCreditStatus === "canceled") && statusAmountMinor !== null && statusAmountMinor > 0n) {
      const reversalEventId = depositId
        ? `bridge:va:${String(vaId)}:deposit:${depositId}:reversal`
        : `bridge:va:${String(vaId)}:event:${ev.event_id}:reversal`;
      const { data: reversalResult, error: reversalErr } = await supabase.rpc("apply_bridge_va_debit", {
        p_event_id:         reversalEventId,
        p_bridge_va_id:     String(vaId),
        p_user_id:          owner.account_type === "individual" ? owner.resolved : null,
        p_business_user_id: owner.account_type === "business"   ? owner.resolved : null,
        p_currency:         currency,
        p_amount_minor:     statusAmountMinor.toString(),
        p_metadata: {
          source: "bridge",
          kind: "virtual_account_deposit_reversal",
          webhook_event_id: ev.event_id,
          reversal_event_id: reversalEventId,
          virtual_account: vaId,
          bridge_customer: customer,
          deposit_id: depositId || null,
          description: transactionStatusDescription(nonCreditStatus),
          status: nonCreditStatus,
          activity_type: activityType,
          gross_amount: statusBreakdown ? minorToDecimal(statusBreakdown.grossMinor, currency) : null,
          developer_fee_amount: statusBreakdown ? minorToDecimal(statusBreakdown.developerFeeMinor, currency) : null,
          exchange_fee_amount: statusBreakdown ? minorToDecimal(statusBreakdown.exchangeFeeMinor, currency) : null,
          net_amount: statusBreakdown ? minorToDecimal(statusBreakdown.netMinor, currency) : null,
          raw: d,
        },
      });
      if (reversalErr) {
        throw new Error(`apply_bridge_va_debit failed: ${reversalErr.message}`);
      }
      const reversalRow = Array.isArray(reversalResult) ? reversalResult[0] : reversalResult;
      reversal = {
        applied: reversalRow?.applied ?? false,
        debited_amount_minor: reversalRow?.debited_amount_minor ?? null,
        new_balance_minor: reversalRow?.new_balance_minor ?? null,
      };
    }

    const statusMetadata = {
      source: "bridge",
      kind: "virtual_account_deposit_status",
      bridge_event_id: ev.event_id,
      virtual_account_id: String(vaId),
      deposit_id: receiptDepositId || null,
      status: nonCreditStatus,
      activity_type: activityType,
      amount: statusAmountMinor == null ? d?.amount ?? null : minorToDecimal(statusAmountMinor, currency),
      gross_amount: statusBreakdown ? minorToDecimal(statusBreakdown.grossMinor, currency) : null,
      developer_fee_amount: statusBreakdown ? minorToDecimal(statusBreakdown.developerFeeMinor, currency) : null,
      exchange_fee_amount: statusBreakdown ? minorToDecimal(statusBreakdown.exchangeFeeMinor, currency) : null,
      net_amount: statusBreakdown ? minorToDecimal(statusBreakdown.netMinor, currency) : null,
      currency,
      direction: "credit",
      ...(deliversToExternalWallet ? { delivery: "external_wallet", balance_impact: "none" } : {}),
      receipt: statusReceipt,
      refund_details: refundDetails,
      reversal,
    };
    const { resolved, account_type } = owner;
    const statusReference = receiptDepositId
      ? `bridge:va:${String(vaId)}:deposit:${receiptDepositId}`
      : `bridge:va:${String(vaId)}:event:${ev.event_id}`;
    if (statusAmountMinor !== null) {
      await upsertVirtualAccountStatusTransaction({
        userId: resolved,
        accountType: account_type,
        status: nonCreditStatus,
        amount: statusBreakdown ? minorToDecimal(statusBreakdown.netMinor, currency) : minorToDecimal(statusAmountMinor, currency),
        currency,
        reference: statusReference,
        description: transactionStatusDescription(nonCreditStatus),
        metadata: statusMetadata,
        occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
      });
    }
    const notified = await insertTransactionStatusNotification({
      userId: resolved,
      status: nonCreditStatus,
      amountLabel,
      metadata: statusMetadata,
      idempotencyMatch: receiptDepositId || depositId
        ? { deposit_id: receiptDepositId || depositId, kind: "virtual_account_deposit_status", status: nonCreditStatus }
        : { bridge_event_id: ev.event_id, kind: "virtual_account_deposit_status", status: nonCreditStatus },
    });
    if (statusAmountMinor !== null) {
      await emailTransactionStatusBestEffort({
        userId: resolved,
        accountType: account_type,
        status: nonCreditStatus,
        amount: minorToDecimal(statusAmountMinor, currency),
        currency,
        reference: receiptDepositId || String(d?.reference ?? d?.source?.tracking_number ?? ev.event_id),
        description: nonCreditStatus === "in_review" ? "Deposit under compliance review" : String(refundDetails.return_reason || d?.refund?.reason || ""),
        occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
        idempotencyKey: `wh:tx-status:${resolved}:va:${receiptDepositId || ev.event_id}:${nonCreditStatus}${nonCreditStatus === "refunded" ? ":refund-receipt-v2" : ""}`,
        grossAmount: statusBreakdown ? minorToDecimal(statusBreakdown.grossMinor, currency) : null,
        developerFeeAmount: statusBreakdown ? minorToDecimal(statusBreakdown.developerFeeMinor, currency) : null,
        exchangeFeeAmount: statusBreakdown ? minorToDecimal(statusBreakdown.exchangeFeeMinor, currency) : null,
        netAmount: statusBreakdown ? minorToDecimal(statusBreakdown.netMinor, currency) : null,
        sourceCurrency: String(statusReceipt.source_currency || currency),
        sourceAmount: Number(statusReceipt.source_amount ?? NaN),
        serviceChargeAmount: Number(statusReceipt.service_charge_amount ?? NaN),
        availableAmount: Number(statusReceipt.available_amount ?? NaN),
        destinationCurrency: String(statusReceipt.destination_currency || ""),
        destinationAmount: Number(statusReceipt.destination_amount ?? NaN),
        exchangeRate: Number(statusReceipt.exchange_rate ?? NaN),
        destinationAddress: String(statusReceipt.destination_address || ""),
        sourceRail: String(statusReceipt.source_rail || ""),
        depositId: receiptDepositId || null,
        refundReturnReason: String(refundDetails.return_reason || ""),
        refundReturnedAt: String(refundDetails.returned_at || ""),
        refundRiskRejectionReason: String(refundDetails.risk_rejection_reason || ""),
        refundRail: String(refundDetails.refund_rail || ""),
        refundBeneficiaryName: String(refundDetails.refund_beneficiary_name || ""),
        refundReferenceId: String(refundDetails.refund_reference_id || ""),
      });
    }

    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        skipped: "non_credit_activity_status",
        activity_type: activityType,
        deposit_id: receiptDepositId || depositId || null,
        status: nonCreditStatus,
        notified,
        reversal,
      },
    });
    return;
  }

  if (!isFiatVirtualAccountCreditEvent(activityType, currency, eventCurrency)) {
    const isConvertedSettlement = isConvertedVirtualAccountSettlementEvent(activityType, currency, eventCurrency);
    const depositId = String(d?.deposit_id ?? "").trim();
    const statusBreakdown = receivedAmountBreakdown(d, currency);
    const statusReceipt = bridgeVaReceiptDetails({
      payload: d,
      sourceCurrency: currency,
      vaId,
      accountDetails,
      breakdown: statusBreakdown,
    });
    const receiptDepositId = String(statusReceipt.deposit_id || depositId || "").trim();
    const approvedStatus = normalizeTransactionEmailStatus(activityType) === "approved" || activityType === "payment_processed";
    if (isConvertedSettlement && approvedStatus && statusBreakdown?.netMinor && statusBreakdown.netMinor > 0n) {
      const amountDecimal = minorToDecimal(statusBreakdown.netMinor, currency);
      const amountLabel = formatMinorUnits(statusBreakdown.netMinor, currency);
      const statusMetadata = {
        source: "bridge",
        kind: "virtual_account_deposit_status",
        bridge_event_id: ev.event_id,
        virtual_account_id: String(vaId),
        deposit_id: receiptDepositId || depositId || null,
        status: "approved",
        activity_type: activityType,
        amount: amountDecimal,
        gross_amount: minorToDecimal(statusBreakdown.grossMinor, currency),
        developer_fee_amount: minorToDecimal(statusBreakdown.developerFeeMinor, currency),
        exchange_fee_amount: minorToDecimal(statusBreakdown.exchangeFeeMinor, currency),
        net_amount: amountDecimal,
        currency,
        direction: "credit",
        converted_currency: eventCurrency,
        balance_impact: "none",
        receipt: statusReceipt,
      };
      const { resolved, account_type } = owner;
      await insertTransactionStatusNotification({
        userId: resolved,
        status: "approved",
        amountLabel,
        metadata: statusMetadata,
        idempotencyMatch: receiptDepositId || depositId
          ? { deposit_id: receiptDepositId || depositId, kind: "virtual_account_deposit_status", status: "approved" }
          : { bridge_event_id: ev.event_id, kind: "virtual_account_deposit_status", status: "approved" },
      });
      await emailTransactionStatusBestEffort({
        userId: resolved,
        accountType: account_type,
        status: "approved",
        amount: amountDecimal,
        currency,
        reference: receiptDepositId || String(d?.reference ?? d?.source?.tracking_number ?? ev.event_id),
        description: "Deposit processed",
        occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
        idempotencyKey: `wh:tx-status:${resolved}:va:${receiptDepositId || ev.event_id}:approved`,
        grossAmount: minorToDecimal(statusBreakdown.grossMinor, currency),
        developerFeeAmount: minorToDecimal(statusBreakdown.developerFeeMinor, currency),
        exchangeFeeAmount: minorToDecimal(statusBreakdown.exchangeFeeMinor, currency),
        netAmount: amountDecimal,
        sourceCurrency: String(statusReceipt.source_currency || currency),
        sourceAmount: Number(statusReceipt.source_amount ?? NaN),
        serviceChargeAmount: Number(statusReceipt.service_charge_amount ?? NaN),
        availableAmount: Number(statusReceipt.available_amount ?? NaN),
        destinationCurrency: String(statusReceipt.destination_currency || eventCurrency),
        destinationAmount: Number(statusReceipt.destination_amount ?? NaN),
        exchangeRate: Number(statusReceipt.exchange_rate ?? NaN),
        destinationAddress: String(statusReceipt.destination_address || ""),
        sourceRail: String(statusReceipt.source_rail || ""),
        depositId: receiptDepositId || null,
      });
    }
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        deposit_id: depositId || null,
        activity_type: activityType,
        source_currency: currency,
        event_currency: eventCurrency,
        credited: false,
        skipped: isConvertedSettlement ? "converted_settlement_status_only" : "non_credit_activity_status",
      },
    });
    return;
  }

  const approvedBreakdown = receivedAmountBreakdown(d, currency);
  const amountMinor = approvedBreakdown?.netMinor ?? toMinorUnits(d?.amount, currency);
  if (amountMinor === null) {
    // Malformed or unsupported currency. Audit + complete; do NOT mutate balance.
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  { source: "bridge", kind: "virtual_account", virtual_account_id: vaId,
                    skipped: "unsupported_or_malformed_amount", currency, amount_raw: d?.amount },
    });
    return;
  }
  if (amountMinor <= 0n) {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  { source: "bridge", kind: "virtual_account", virtual_account_id: vaId,
                    skipped: "non_positive_net_amount", amount_minor: amountMinor.toString(),
                    gross_amount_minor: approvedBreakdown ? approvedBreakdown.grossMinor.toString() : null,
                    developer_fee_minor: approvedBreakdown ? approvedBreakdown.developerFeeMinor.toString() : null,
                    exchange_fee_minor: approvedBreakdown ? approvedBreakdown.exchangeFeeMinor.toString() : null },
    });
    return;
  }

  const { resolved, account_type } = owner;
  const depositId = String(d?.deposit_id ?? "").trim();
  const approvedReceipt = bridgeVaReceiptDetails({
    payload: d,
    sourceCurrency: currency,
    vaId,
    accountDetails,
    breakdown: approvedBreakdown,
  });
  const receiptDepositId = String(approvedReceipt.deposit_id || depositId || "").trim();
  const creditEventId = receiptDepositId
    ? `bridge:va:${String(vaId)}:deposit:${receiptDepositId}`
    : ev.event_id;
  if (deliversToExternalWallet) {
    const amountDecimal = minorToDecimal(amountMinor, currency);
    const amountLabel = formatMinorUnits(amountMinor, currency);
    const statusMetadata = {
      source: "bridge",
      kind: "virtual_account_deposit_status",
      bridge_event_id: ev.event_id,
      virtual_account_id: String(vaId),
      deposit_id: receiptDepositId || depositId || null,
      status: "approved",
      activity_type: activityType,
      amount: amountDecimal,
      gross_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
      developer_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
      exchange_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
      net_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null,
      currency,
      direction: "credit",
      delivery: "external_wallet",
      balance_impact: "none",
      receipt: approvedReceipt,
    };
    await upsertVirtualAccountStatusTransaction({
      userId: resolved,
      accountType: account_type,
      status: "approved",
      amount: amountDecimal,
      currency,
      reference: creditEventId,
      description: "Deposit delivered to external wallet",
      metadata: statusMetadata,
      occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
    });
    await insertTransactionStatusNotification({
      userId: resolved,
      status: "approved",
      amountLabel,
      metadata: statusMetadata,
      idempotencyMatch: receiptDepositId || depositId
        ? { deposit_id: receiptDepositId || depositId, kind: "virtual_account_deposit_status", status: "approved" }
        : { bridge_event_id: ev.event_id, kind: "virtual_account_deposit_status", status: "approved" },
    });
    await emailTransactionStatusBestEffort({
      userId: resolved,
      accountType: account_type,
      status: "approved",
      amount: amountDecimal,
      currency,
      reference: receiptDepositId || String(d?.reference ?? d?.source?.tracking_number ?? ev.event_id),
      description: "Deposit delivered to your external wallet",
      occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
      idempotencyKey: `wh:tx-status:${resolved}:va:${receiptDepositId || ev.event_id}:approved`,
      grossAmount: approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
      developerFeeAmount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
      exchangeFeeAmount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
      netAmount: approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null,
      sourceCurrency: String(approvedReceipt.source_currency || currency),
      sourceAmount: Number(approvedReceipt.source_amount ?? NaN),
      serviceChargeAmount: Number(approvedReceipt.service_charge_amount ?? NaN),
      availableAmount: Number(approvedReceipt.available_amount ?? NaN),
      destinationCurrency: String(approvedReceipt.destination_currency || ""),
      destinationAmount: Number(approvedReceipt.destination_amount ?? NaN),
      exchangeRate: Number(approvedReceipt.exchange_rate ?? NaN),
      destinationAddress: String(approvedReceipt.destination_address || ""),
      sourceRail: String(approvedReceipt.source_rail || ""),
      depositId: receiptDepositId || null,
    });
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        deposit_id: depositId || null,
        credited: false,
        delivered_to: "external_wallet",
        amount_minor: amountMinor.toString(),
      },
    });
    return;
  }

  // Canonical Bridge balance + auditable ledger. Idempotent on event_id.
  const { data: creditResult, error: creditErr } = await supabase.rpc("apply_bridge_va_credit", {
    p_event_id:         creditEventId,
    p_bridge_va_id:     String(vaId),
    p_user_id:          account_type === "individual" ? resolved : null,
    p_business_user_id: account_type === "business"   ? resolved : null,
    p_currency:         currency,
    // PostgREST serialises bigint via JSON — pass as string to avoid float coercion.
    p_amount_minor:     amountMinor.toString(),
    p_metadata: {
      source:           "bridge",
      webhook_event_id: ev.event_id,
      credit_event_id:  creditEventId,
      virtual_account:  vaId,
      bridge_customer:  customer,
      deposit_id:       receiptDepositId || depositId || null,
      developer_fee_percent: owner.developer_fee_percent,
      gross_amount:     approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
      developer_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
      exchange_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
      net_amount:       approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null,
      reference:        d?.reference ?? null,
      receipt:          approvedReceipt,
      raw:              d,
    },
  });
  if (creditErr) {
    throw new Error(`apply_bridge_va_credit failed: ${creditErr.message}`);
  }
  const creditRow = Array.isArray(creditResult) ? creditResult[0] : creditResult;
  // Bridge virtual-account credit payloads are not guaranteed to use the same
  // activity status wording across rails. If we reached this branch, parsed a
  // positive amount, and the idempotent credit actually applied, the customer
  // must receive an approved incoming-payment notification even when the raw
  // activity status is blank or unmapped.
  if (creditRow?.applied) {
    const amountDecimal = minorToDecimal(amountMinor, currency);
    const amountLabel = formatMinorUnits(amountMinor, currency);
    const statusMetadata = {
      source: "bridge",
      kind: "virtual_account_deposit_status",
      bridge_event_id: ev.event_id,
      virtual_account_id: String(vaId),
      deposit_id: receiptDepositId || depositId || null,
      status: "approved",
      activity_type: activityType,
      amount: amountDecimal,
      gross_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
      developer_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
      exchange_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
      net_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null,
      currency,
      receipt: approvedReceipt,
    };
    await insertTransactionStatusNotification({
      userId: resolved,
      status: "approved",
      amountLabel,
      metadata: statusMetadata,
      idempotencyMatch: receiptDepositId || depositId
        ? { deposit_id: receiptDepositId || depositId, kind: "virtual_account_deposit_status", status: "approved" }
        : { bridge_event_id: ev.event_id, kind: "virtual_account_deposit_status", status: "approved" },
    });
    // Do not email on the first fiat funds_received leg. Bridge sends a later
    // converted settlement event with the full receipt (incoming amount,
    // transaction fee, outgoing asset, destination). That final leg is handled
    // as status-only above and uses the same deposit id for idempotency.
  }

  // For individuals only, mirror to the legacy wallets table so the existing
  // TransactionsScreen (which reads wallets/transactions) keeps working.
  // bridge_virtual_account_balances is the canonical Bridge balance source.
  // Business users are NOT mirrored — they read Bridge balance tables only.
  //
  // Uses the Bridge-specific RPC (provider='bridge' on the transactions
  // row). Layered idempotency: the canonical ledger gate above
  // (creditRow.applied) prevents double-mirroring on duplicate webhooks;
  // the RPC itself is also idempotent via the transactions.reference
  // UNIQUE constraint with reference='bridge:<event_id>'.
  if (account_type === "individual" && creditRow?.applied) {
    const amountDecimal = Number(amountMinor) / 10 ** (CURRENCY_SCALE[currency] ?? 2);
    const { error: mirrorErr } = await supabase.rpc("apply_bridge_wallet_credit_and_complete", {
      p_event_id:     ev.event_id,
      p_user_id:      resolved,
      p_currency:     currency,
      p_amount:       amountDecimal,
      p_tx_reference: `bridge:${ev.event_id}`,
      p_tx_metadata:  {
        virtual_account_id: vaId,
        bridge_reference: d?.reference ?? null,
        payload: d,
        mirror_of: "bridge_balance_ledger",
        gross_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
        developer_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
        exchange_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
        net_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null,
      },
    });
    if (mirrorErr) {
      throw new Error(`apply_bridge_wallet_credit_and_complete failed: ${mirrorErr.message}`);
    }
    // Backlink the webhook event to the VA for ops visibility (the RPC does
    // not touch bridge_webhook_events; we always set the entity backlink
    // for the activity branch here).
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    return;
  }

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
    .eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  { source: "bridge", kind: "virtual_account", virtual_account_id: vaId,
                  applied: creditRow?.applied ?? false,
                  new_balance_minor: creditRow?.new_balance_minor ?? null },
  });
}

async function handleBridgeWallet(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the wallet; event_object_id its id.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const walletId = d?.wallet_id ?? d?.bridge_wallet_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!walletId) throw new Error("bridge wallet event missing wallet_id");

  const payloadCustomer = d?.customer_id ?? d?.customer?.id ?? d?.bridge_customer_id ?? d?.bridge_wallet?.customer_id;
  let customer = payloadCustomer ? String(payloadCustomer) : "";
  let resolved = "";
  let account_type: "individual" | "business" = "individual";
  const t = ev.event_type.toLowerCase();
  const isActivity = t.includes("activity") || t.includes("deposit") || t.includes("credit");

  if (customer) {
    const owner = await resolveOwnerFromBridgeCustomer(customer);
    resolved = owner.resolved;
    account_type = owner.account_type;
  } else {
    const { data: mappedWallet } = await supabase
      .from("bridge_wallets")
      .select("bridge_customer_id,user_id,business_user_id")
      .eq("bridge_wallet_id", String(walletId))
      .maybeSingle();

    if (!mappedWallet?.bridge_customer_id) {
      const rawAmount = Number(d?.amount);
      const isFinancialActivity = isActivity && Number.isFinite(rawAmount) && rawAmount > 0;
      if (isFinancialActivity) {
        throw new Error("reconciliation_required:wallet_activity_missing_customer_mapping");
      }
      await supabase.from("bridge_webhook_events")
        .update({ target_entity_type: "wallet", target_entity_id: String(walletId) })
        .eq("event_id", ev.event_id);
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary: {
          source: "bridge",
          kind: "wallet",
          wallet_id: walletId,
          reconciliation_required: "wallet_activity_missing_customer_mapping",
        },
      });
      return;
    }

    customer = String(mappedWallet.bridge_customer_id);
    if (mappedWallet.user_id) {
      resolved = String(mappedWallet.user_id);
      account_type = "individual";
    } else if (mappedWallet.business_user_id) {
      resolved = String(mappedWallet.business_user_id);
      account_type = "business";
    } else {
      const owner = await resolveOwnerFromBridgeCustomer(customer);
      resolved = owner.resolved;
      account_type = owner.account_type;
    }
  }

  const amountValue = Number(d?.amount);
  const currency = String(d?.currency ?? "USDC").toUpperCase();
  const amountMinor = toMinorUnits(d?.amount, currency);
  const walletActivityDirection = inferWalletActivityDirection(t, d, amountMinor);
  const walletActivityTransferId = bridgeTransferIdFromPayload(d);
  const walletActivityType = String(d?.type || "").toLowerCase();
  const paymentRouteType = String(d?.payment_route?.type || "").toLowerCase();
  const isDirectWalletDeposit =
    walletActivityDirection === "credit" &&
    ["direct_deposit", "deposit"].includes(walletActivityType) &&
    paymentRouteType !== "virtual_account_event";
  const walletActivityAmount =
    amountMinor !== null
      ? minorToDecimal(absMinor(amountMinor), currency)
      : Math.abs(amountValue);
  const shouldProjectWalletActivityTx =
    isActivity && Number.isFinite(walletActivityAmount) && walletActivityAmount > 0 && !!resolved;

  await supabase.from("bridge_wallets").upsert({
    bridge_wallet_id:    String(walletId),
    bridge_customer_id:  String(customer),
    user_id:             account_type === "individual" ? resolved : null,
    business_user_id:    account_type === "business"   ? resolved : null,
    currency:            String(d?.currency ?? "usdc").toLowerCase(),
    chain:               String(d?.chain ?? "base").toLowerCase(),
    address:             String(d?.address ?? d?.deposit_address ?? ""),
    status:              String(d?.status ?? "active").toLowerCase(),
    updated_at:          new Date().toISOString(),
  }, { onConflict: "bridge_wallet_id" });

  // Projection repair/prevention: wallet activity with amount should emit a
  // canonical ledger/transaction row idempotently. Customer-facing
  // notifications are owned by the deposit/transfer lifecycle handlers, not
  // raw wallet activity, otherwise one Bridge movement appears twice.
  if (shouldProjectWalletActivityTx) {
    const txReference = `bridge:${ev.event_id}`;
    await supabase.from("transactions").upsert({
      user_id:     resolved,
      type:        walletActivityDirection === "credit" ? "deposit" : "withdrawal",
      amount:      walletActivityAmount,
      currency,
      status:      "completed",
      reference:   txReference,
      metadata:    {
        source: "bridge",
        kind: "wallet_activity",
        direction: walletActivityDirection,
        transaction_type: walletActivityDirection === "credit" ? "deposit" : "withdrawal",
        balance_impact: walletActivityDirection,
        signed_amount: amountMinor === null ? amountValue : minorToDecimal(amountMinor, currency),
        amount_minor: amountMinor === null ? null : absMinor(amountMinor).toString(),
        bridge_event_id: ev.event_id,
        bridge_wallet_id: String(walletId),
        bridge_transfer_id: walletActivityTransferId,
        bridge_customer_id: String(customer),
        raw: d,
      },
      provider:    "bridge",
      description: walletActivityDirection === "credit" ? "Wallet deposit credit" : "Wallet transfer debit",
      updated_at:  new Date().toISOString(),
    }, { onConflict: "reference" });

    if (amountMinor !== null) {
      await supabase.from("bridge_balance_ledger").upsert({
        event_id: ev.event_id,
        provider: "bridge",
        entity_type: "wallet",
        entity_id: String(walletId),
        user_id: account_type === "individual" ? resolved : null,
        business_user_id: account_type === "business" ? resolved : null,
        currency,
        amount_minor: absMinor(amountMinor).toString(),
        direction: walletActivityDirection,
        metadata: {
          source: "bridge",
          kind: "wallet_activity",
          direction: walletActivityDirection,
          transaction_type: walletActivityDirection === "credit" ? "deposit" : "withdrawal",
          balance_impact: walletActivityDirection,
          bridge_event_id: ev.event_id,
          bridge_wallet_id: String(walletId),
          bridge_transfer_id: walletActivityTransferId,
          bridge_customer_id: String(customer),
          raw: d,
        },
      }, { onConflict: "event_id", ignoreDuplicates: true });
    }

    if (isDirectWalletDeposit) {
      const availableBalance = Number(d?.available_balance);
      await emailWalletActivityBestEffort({
        userId: resolved,
        accountType: account_type,
        direction: "credit",
        amount: walletActivityAmount,
        currency,
        reference: walletActivityTransferId || String(d?.id || ev.event_id),
        description: "Direct wallet deposit",
        occurredAt: String(d?.created_at || ev.payload?.event_created_at || ""),
        newBalance: Number.isFinite(availableBalance) ? availableBalance : null,
        idempotencyKey: `wh:wallet-activity:${resolved}:${walletActivityTransferId || d?.id || ev.event_id}:credit`,
      });
    }
  }

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: "wallet", target_entity_id: String(walletId) })
    .eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  { source: "bridge", kind: "wallet", wallet_id: walletId },
  });
}

async function handleBridgeExternalAccount(ev: PendingEvent): Promise<void> {
  const t = ev.event_type.toLowerCase();
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const externalAccountId = d?.external_account_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!externalAccountId) {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  { source: "bridge", kind: "external_account", skipped: "missing_external_account_id" },
    });
    return;
  }

  const customer = d?.customer_id ?? d?.customer?.id;
  if (!customer) {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  {
        source: "bridge",
        kind: "external_account",
        external_account_id: String(externalAccountId),
        skipped: "missing_customer_id",
      },
    });
    return;
  }

  const owner = await resolveOwnerFromBridgeCustomer(String(customer));
  await syncCountryFromBridgeCustomer(String(customer), owner);
  const status =
    String(d?.status ?? "").toLowerCase()
    || (t.includes("deleted") || t.includes("deactivated") ? "deleted" : "active");
  const active = !["deleted", "deactivated", "inactive", "disabled", "closed"].includes(status);
  const accountType = String(d?.account_type ?? d?.type ?? "").toLowerCase();
  const currency = String(d?.currency ?? d?.bank_account?.currency ?? "").toUpperCase();
  const last4 =
    String(
      d?.last_4
      ?? d?.account_last4
      ?? d?.bank_account?.account_last4
      ?? d?.bank_account?.last_4
      ?? "",
    );
  const ownerName =
    String(d?.account_owner_name ?? d?.owner_name ?? d?.bank_account?.account_owner_name ?? "");

  await supabase.from("bridge_external_accounts").upsert({
    bridge_external_account_id: String(externalAccountId),
    bridge_customer_id: String(customer),
    user_id: owner.resolved,
    account_type: accountType || null,
    currency: currency || null,
    account_owner_name: ownerName || null,
    account_owner_type: d?.account_owner_type ?? null,
    bank_name: d?.bank_name ?? d?.bank_account?.bank_name ?? null,
    last_4: last4 || null,
    rail: d?.rail ?? d?.payment_rail ?? null,
    status,
    active,
    metadata: d ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "bridge_external_account_id" });

  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "external_account",
      external_account_id: String(externalAccountId),
      status,
      active,
      recognized_event: t.endsWith(".created") || t.endsWith(".updated") || t.endsWith(".deleted"),
    },
  });
}

async function handleBridgeTransfer(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the transfer; event_object_id its id.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const transferId = d?.transfer_id ?? d?.id ?? ev.payload?.event_object_id;
  const customer   = d?.customer_id ?? d?.customer?.id ?? d?.source?.customer_id ?? d?.destination?.customer_id;
  if (!transferId) throw new Error("bridge transfer event missing id");

  const providerState = String(d?.state ?? d?.status ?? "").toLowerCase();
  const mappedState = mapBridgeTransferState(providerState);
  if (!mappedState.recognized) {
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "transfer", target_entity_id: String(transferId) })
      .eq("event_id", ev.event_id);
    throw new Error(`reconciliation_required:unknown_transfer_state:${mappedState.providerState}`);
  }

  let owner: { resolved: string | null; account_type: "individual" | "business" | null } = { resolved: null, account_type: null };
  let reconciliationReason: string | null = null;
  if (!customer) {
    reconciliationReason = "missing_customer_id";
  } else {
    try {
      owner = await resolveOwnerFromBridgeCustomer(customer);
    } catch (e) {
      reconciliationReason = `owner_unmapped_for_customer:${String(customer)}`;
      console.error(`bridge transfer reconciliation required for transfer=${transferId}: ${(e as Error).message}`);
    }
  }

  const normSource = normalizeBridgeEndpointType(d?.source?.type ?? d?.source?.payment_rail ?? "external_bank");
  const normDest   = normalizeBridgeEndpointType(d?.destination?.type ?? d?.destination?.payment_rail ?? "external_bank");
  const direction  = bridgeTransferDirection(normSource, normDest);
  const transactionType = direction === "debit" ? "withdrawal" : "deposit";

  const amount   = Number(d?.amount ?? 0);
  const currency = String(d?.currency ?? d?.source?.currency ?? "USD").toUpperCase();
  const receiptBreakdown = transferReceiptBreakdown(d, currency);
  const displayAmount = receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : amount;
  // 1) Bridge transfer projection + lifecycle state must flow via canonical RPC
  // (no direct runtime upsert on bridge_transfers).
  const transferState = mappedState.recognized
    ? (mappedState.providerState === "payment_processed"
        ? "succeeded"
        : (mappedState.providerState === "canceled" ? "cancelled" : (
          ["returned", "refunded"].includes(mappedState.providerState)
            ? mappedState.providerState
            : mappedState.transactionStatus === "failed"
              ? "failed"
              : "pending"
        )))
    : "pending";
  const transferRaw = {
    ...d,
    borderpay_reconciliation_reason: reconciliationReason,
    borderpay_provider_state_recognized: mappedState.recognized,
  };
  const { error: btErr } = await supabase.rpc("upsert_bridge_transfer_projection", {
    p_bridge_transfer_id: String(transferId),
    p_user_id: owner.account_type === "individual" ? owner.resolved : null,
    p_business_user_id: owner.account_type === "business" ? owner.resolved : null,
    p_source_type: normSource,
    p_destination_type: normDest,
    p_amount: amount,
    p_currency: currency,
    p_state: transferState,
    p_raw: transferRaw,
  });
  if (btErr) {
    throw new Error(`upsert_bridge_transfer_projection failed: ${btErr.message}`);
  }

  if (reconciliationReason) {
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "transfer", target_entity_id: String(transferId) })
      .eq("event_id", ev.event_id);
    throw new Error(`reconciliation_required:${reconciliationReason}`);
  }

  // 2. Mirror into public.transactions so existing readers (TransactionsScreen,
  //    exports, admin views) reflect Bridge activity. Idempotent via the
  //    partial unique index transactions_bridge_transfer_uniq. The schema only
  //    carries user_id today, so for businesses we use the owner's auth.uid
  //    and tag metadata.account_type='business' — no business transaction
  //    schema invented here per CTO directive.
  if (owner.resolved) {
    const { error: txErr } = await supabase.rpc("upsert_bridge_transaction", {
      p_user_id:            owner.resolved,
      p_bridge_transfer_id: String(transferId),
      p_amount:             amount,
      p_currency:           currency,
      p_status:             mappedState.transactionStatus,
      p_metadata: {
        source:           "bridge",
        transaction_type: transactionType,
        direction,
        balance_impact:   direction,
        flow:             "bridge_transfer",
        account_type:     owner.account_type,
        source_type:      normSource,
        destination_type: normDest,
        bridge_state:     mappedState.providerState,
        bridge_state_recognized: mappedState.recognized,
        receipt: receiptBreakdown ? {
          initial_amount: minorToDecimal(receiptBreakdown.grossMinor, currency),
          developer_fee: minorToDecimal(receiptBreakdown.developerFeeMinor, currency),
          exchange_fee: minorToDecimal(receiptBreakdown.exchangeFeeMinor, currency),
          final_amount: minorToDecimal(receiptBreakdown.netMinor, currency),
        } : d?.receipt ?? null,
        gross_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.grossMinor, currency) : null,
        developer_fee_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.developerFeeMinor, currency) : null,
        exchange_fee_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.exchangeFeeMinor, currency) : null,
        net_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : null,
        raw:              d,
      },
    });
    if (txErr) {
      throw new Error(`upsert_bridge_transaction failed: ${txErr.message}`);
    }

    if (mappedState.transactionStatus === "completed") {
      await supabase.rpc("award_growth_first_transaction_from_bridge_event", {
        p_event_id: ev.event_id,
        p_bridge_customer_id: customer ? String(customer) : null,
        p_bridge_transfer_id: String(transferId),
        p_status: mappedState.transactionStatus,
        p_payload: d,
      });
    }

    const emailStatus = normalizeTransactionEmailStatus(mappedState.providerState);
    if (emailStatus && Number.isFinite(amount) && amount > 0) {
      const amountMinor = receiptBreakdown?.netMinor ?? toMinorUnits(String(amount), currency);
      const amountLabel = amountMinor === null ? `${amount} ${currency}` : formatMinorUnits(amountMinor, currency);
      const statusMetadata = {
        source: "bridge",
        kind: "transfer_status",
        direction,
        transaction_type: transactionType,
        balance_impact: direction,
        bridge_event_id: ev.event_id,
        bridge_transfer_id: String(transferId),
        status: emailStatus,
        provider_state: mappedState.providerState,
        amount: displayAmount,
        gross_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.grossMinor, currency) : null,
        developer_fee_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.developerFeeMinor, currency) : null,
        exchange_fee_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.exchangeFeeMinor, currency) : null,
        net_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : null,
        currency,
      };
      await insertTransactionStatusNotification({
        userId: owner.resolved,
        status: emailStatus,
        amountLabel,
        metadata: statusMetadata,
        idempotencyMatch: { bridge_transfer_id: String(transferId), kind: "transfer_status", status: emailStatus },
      });
      await emailTransactionStatusBestEffort({
        userId: owner.resolved,
        accountType: owner.account_type ?? "individual",
        status: emailStatus,
        amount: displayAmount,
        currency,
        reference: String(transferId),
        description: `Transfer ${transactionStatusTitle(emailStatus).toLowerCase()}`,
        occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
        idempotencyKey: `wh:tx-status:${owner.resolved}:transfer:${String(transferId)}:${emailStatus}`,
        grossAmount: receiptBreakdown ? minorToDecimal(receiptBreakdown.grossMinor, currency) : null,
        developerFeeAmount: receiptBreakdown ? minorToDecimal(receiptBreakdown.developerFeeMinor, currency) : null,
        exchangeFeeAmount: receiptBreakdown ? minorToDecimal(receiptBreakdown.exchangeFeeMinor, currency) : null,
        netAmount: receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : null,
      });
    }
  }

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: "transfer", target_entity_id: String(transferId) })
    .eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  {
      source: "bridge",
      kind: "transfer",
      transfer_id: transferId,
      provider_state: mappedState.providerState,
      internal_status: mappedState.transactionStatus,
      recognized: mappedState.recognized,
    },
  });
}

async function ensureStablecoinWalletsProvisioned(input: {
  userId: string;
  bridgeCustomerId: string;
  accountType: "individual" | "business";
}): Promise<void> {
  const { data: operatorRow, error: operatorLookupError } = await supabase
    .from("operator_bridge_accounts")
    .select("bridge_customer_id")
    .eq("bridge_customer_id", input.bridgeCustomerId)
    .eq("active", true)
    .maybeSingle();
  if (operatorLookupError) {
    throw new Error(`operator_bridge_accounts lookup failed: ${operatorLookupError.message}`);
  }
  if (operatorRow?.bridge_customer_id) {
    // Imported Bridge operator/admin accounts are not BorderPay customer
    // lifecycle subjects. Skip auto-provisioning entirely.
    return;
  }

  const profileTable = input.accountType === "business" ? "business_profiles" : "user_profiles";
  const idCol = input.accountType === "business" ? "user_id" : "id";
  const statusCol = input.accountType === "business" ? "bridge_kyb_status" : "bridge_kyc_status";
  const { data: profile } = await supabase
    .from(profileTable)
    .select(`country, ${statusCol}`)
    .eq(idCol, input.userId)
    .maybeSingle();

  let country = String(profile?.country || "");
  if (!country && input.accountType === "business") {
    const { data: userProfile } = await supabase
      .from("user_profiles")
      .select("country")
      .eq("id", input.userId)
      .maybeSingle();
    country = String(userProfile?.country || "");
  }
  if (isBridgeBlocked(country) || !isBridgeCustodialWalletSupported(country)) return;
  const statusValue = (profile as Record<string, unknown> | null)?.[statusCol];
  if (String(statusValue || "").toLowerCase() !== "approved") return;

  for (const { symbol, chain } of DEFAULT_STABLECOIN_WALLETS) {
    const chainLc = chain.toLowerCase();
    const lock = await tryAcquireProvisioningLock(input.bridgeCustomerId, symbol, chainLc);
    if (lock.state === "already_completed" || lock.state === "busy") continue;

    try {
      const { data: existing } = await supabase
        .from("bridge_wallets")
        .select("bridge_wallet_id,address")
        .eq("bridge_customer_id", input.bridgeCustomerId)
        .ilike("currency", symbol)
        .ilike("chain", chainLc)
        .maybeSingle();
      if (existing?.bridge_wallet_id) {
        await completeProvisioningLock(lock.lockEventId, "already_exists");
        continue;
      }

      const created = await bridgeProvider.createWallet({
        customer_id: input.bridgeCustomerId,
        symbol,
        chain,
      });
      await supabase.from("bridge_wallets").upsert({
        bridge_wallet_id:   created.wallet_id,
        bridge_customer_id: input.bridgeCustomerId,
        user_id:            input.accountType === "individual" ? input.userId : null,
        business_user_id:   input.accountType === "business" ? input.userId : null,
        currency:           symbol,
        chain:              chainLc,
        address:            created.deposit_address,
        status:             "active",
        updated_at:         new Date().toISOString(),
      }, { onConflict: "bridge_wallet_id" });
      await completeProvisioningLock(lock.lockEventId, "provisioned");
    } catch (e) {
      await failProvisioningLock(lock.lockEventId, (e as Error).message || "provision_failed");
      throw e;
    }
  }
}

async function syncCountryFromBridgeCustomer(
  bridgeCustomerId: string,
  owner: { resolved: string; account_type: "individual" | "business" },
): Promise<void> {
  const [{ data: userProfile }, { data: businessProfile }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("country, phone, date_of_birth, id_number, id_type, bridge_address_object, bridge_identity_metadata")
      .eq("id", owner.resolved)
      .maybeSingle(),
    owner.account_type === "business"
      ? supabase
          .from("business_profiles")
          .select("country, company_phone, address, city, state, postal_code, bridge_identity_metadata")
          .eq("user_id", owner.resolved)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);

  const userCountry = normalizeCountryCode(userProfile?.country);
  const businessCountry = normalizeCountryCode(businessProfile?.country);
  const needsUserIdentity =
    !userProfile?.date_of_birth ||
    !userProfile?.id_number ||
    !userProfile?.id_type;
  const hasBusinessIdentityMetadata =
    businessProfile?.bridge_identity_metadata &&
    typeof businessProfile.bridge_identity_metadata === "object" &&
    Object.keys(businessProfile.bridge_identity_metadata).length > 0;
  const needsBusinessIdentity = owner.account_type === "business" && !hasBusinessIdentityMetadata;
  if (
    userCountry &&
    !needsUserIdentity &&
    (owner.account_type !== "business" || (businessCountry && !needsBusinessIdentity))
  ) return;

  let customer: Awaited<ReturnType<typeof bridgeProvider.getCustomerProfile>> | null = null;
  try {
    customer = await bridgeProvider.getCustomerProfile(bridgeCustomerId);
  } catch (e) {
    // Do not fail financial event processing if customer-profile read is
    // unavailable in Bridge for an imported historical customer mapping.
    console.warn(`country-sync skipped customer=${bridgeCustomerId}: ${(e as Error).message}`);
    return;
  }
  const bridgeCountry = normalizeCountryCode(customer.country ?? customer.address_object?.country);

  const userUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (!userCountry && bridgeCountry) userUpdate.country = bridgeCountry;
  if (!userProfile?.phone && customer.phone) userUpdate.phone = customer.phone;
  if (!userProfile?.date_of_birth && customer.date_of_birth) userUpdate.date_of_birth = customer.date_of_birth;
  if (!userProfile?.id_number && customer.id_number) userUpdate.id_number = customer.id_number;
  if (!userProfile?.id_type && customer.id_type) userUpdate.id_type = customer.id_type;
  if (
    customer.id_number ||
    customer.id_type ||
    customer.date_of_birth ||
    customer.identity_metadata.id_number_present
  ) {
    userUpdate.bridge_identity_metadata = {
      ...(userProfile?.bridge_identity_metadata && typeof userProfile.bridge_identity_metadata === "object"
        ? userProfile.bridge_identity_metadata
        : {}),
      ...customer.identity_metadata,
    };
    userUpdate.bridge_identity_synced_at = new Date().toISOString();
  }
  if (customer.address_object && Object.values(customer.address_object).some((v) => String(v ?? "").trim().length > 0)) {
    userUpdate.bridge_address_object = customer.address_object;
    if (!userProfile?.country && bridgeCountry) userUpdate.country = bridgeCountry;
    const line1 = customer.address_object.street_line_1;
    const line2 = customer.address_object.street_line_2;
    if (line1) userUpdate.address = line2 ? `${line1}, ${line2}` : line1;
    if (customer.address_object.city) userUpdate.city = customer.address_object.city;
    if (customer.address_object.postal_code) userUpdate.postal_code = customer.address_object.postal_code;
  }
  if (Object.keys(userUpdate).length > 1) {
    await supabase.from("user_profiles").update(userUpdate).eq("id", owner.resolved);
  }

  if (owner.account_type === "business") {
    const bizUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (!businessCountry && bridgeCountry) bizUpdate.country = bridgeCountry;
    if (!businessProfile?.company_phone && customer.phone) bizUpdate.company_phone = customer.phone;
    if (
      customer.id_number ||
      customer.id_type ||
      customer.date_of_birth ||
      customer.identity_metadata.id_number_present
    ) {
      bizUpdate.bridge_identity_metadata = {
        ...(businessProfile?.bridge_identity_metadata && typeof businessProfile.bridge_identity_metadata === "object"
          ? businessProfile.bridge_identity_metadata
          : {}),
        ...customer.identity_metadata,
      };
      bizUpdate.bridge_identity_synced_at = new Date().toISOString();
    }
    if (customer.address_object?.street_line_1 && !businessProfile?.address) {
      const line1 = customer.address_object.street_line_1;
      const line2 = customer.address_object.street_line_2;
      bizUpdate.address = line2 ? `${line1}, ${line2}` : line1;
    }
    if (customer.address_object?.city && !businessProfile?.city) bizUpdate.city = customer.address_object.city;
    if (customer.address_object?.state && !businessProfile?.state) bizUpdate.state = customer.address_object.state;
    if (customer.address_object?.postal_code && !businessProfile?.postal_code) bizUpdate.postal_code = customer.address_object.postal_code;
    if (Object.keys(bizUpdate).length > 1) {
      await supabase.from("business_profiles").update(bizUpdate).eq("user_id", owner.resolved);
    }
  }
}

async function resolveOwnerFromBridgeCustomer(bridgeCustomerId: string): Promise<{ resolved: string; account_type: "individual" | "business" }> {
  const { data: bizRows } = await supabase
    .from("business_profiles")
    .select("user_id")
    .eq("bridge_customer_id", String(bridgeCustomerId))
    .limit(2);

  const { data: userRows } = await supabase
    .from("user_profiles")
    .select("id, account_type")
    .eq("bridge_customer_id", String(bridgeCustomerId))
    .limit(2);

  const ownerMap = new Map<string, "individual" | "business">();
  for (const row of (Array.isArray(userRows) ? userRows : [])) {
    const ownerId = String((row as any)?.id || "");
    if (!ownerId) continue;
    const type = (row as any)?.account_type === "business" ? "business" : "individual";
    ownerMap.set(ownerId, type);
  }
  for (const row of (Array.isArray(bizRows) ? bizRows : [])) {
    const ownerId = String((row as any)?.user_id || "");
    if (!ownerId) continue;
    // business_profiles row is canonical for business ownership; upgrade type.
    ownerMap.set(ownerId, "business");
  }
  const owners = Array.from(ownerMap.entries()).map(([resolved, account_type]) => ({ resolved, account_type }));

  if (owners.length === 1) return owners[0];
  if (owners.length === 0) throw new Error(`no profile row for bridge_customer_id=${bridgeCustomerId}`);

  throw new Error(`ambiguous profile rows for bridge_customer_id=${bridgeCustomerId}`);
}

// ── claim & drain ────────────────────────────────────────────────────────

async function processOne(ev: PendingEvent): Promise<{ ok: boolean; error?: string }> {
  try {
    await processEvent(ev);
    return { ok: true };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    await supabase.rpc("fail_pending_event", {
      p_event_id:        ev.event_id,
      p_error:           msg,
      p_backoff_seconds: null,
    });
    return { ok: false, error: msg };
  }
}

async function drain(batchSize = 25): Promise<{ claimed: number; ok: number; failed: number }> {
  // Reap stale 'processing' rows whose worker died.
  await supabase.rpc("reap_stuck_processing", { p_lock_timeout_seconds: 300 });

  const { data: claimed, error } = await supabase.rpc("claim_pending_events", {
    p_worker_id:  WORKER_ID,
    p_batch_size: batchSize,
  });
  if (error) throw error;
  const events = (claimed ?? []) as PendingEvent[];

  let ok = 0;
  let failed = 0;
  // Process serially within a worker invocation to keep memory low and to
  // stay well under Bridge's rate limits. For higher throughput, increase
  // invocation parallelism rather than per-worker concurrency.
  for (const ev of events) {
    const r = await processOne(ev);
    if (r.ok) ok++; else failed++;
  }
  return { claimed: events.length, ok, failed };
}

// ── HTTP entrypoint ──────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "alive", worker: WORKER_ID }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* empty allowed */ }

  // Path 1: Supabase Database Webhook payload — process exactly that record.
  if (body?.type === "INSERT" && body?.table === "pending_events" && body?.record?.event_id) {
    const eventId = body.record.event_id as string;
    // Canonical lifecycle mutation path only: claim via RPC and process drain.
    // We do not issue direct pending_events updates from the worker anymore.
    const result = await drain(1);
    return new Response(JSON.stringify({
      ...result,
      ok: true,
      mode: "insert_webhook_drain",
      requested_event_id: eventId,
    }), { status: 200 });
  }

  // Path 2: drain mode (pg_cron / manual ops).
  const batch = Math.min(Number(body?.batch_size ?? 25), 100);
  const result = await drain(batch);
  return new Response(JSON.stringify({ ...result, ok: true, worker: WORKER_ID }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
