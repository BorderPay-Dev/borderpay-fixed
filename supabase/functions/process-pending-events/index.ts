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

// ── Webhook-email (KYC/KYB decisions only — v1) ──────────────────────────────
// Per docs/bridge-webhook-email-policy.md. v1 wires ONLY terminal KYC/KYB
// decisions (confirmed Bridge vocabulary). VA/wallet/transfer emails are NOT
// wired — their terminal status vocabulary is unconfirmed from real payloads,
// and transfer is dark behind TRANSFERS_LIVE regardless. All sends route through
// the logged `send-email` (never direct Resend) and are BEST-EFFORT: a send
// failure must never fail webhook processing.
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";

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
  reason?: string | null,
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
      props = { company_name: biz?.company_name ?? null, decision, reason: reason ?? null };
    } else {
      template = "individual.kyc_decision";
      props = { full_name: rcpt.full_name, decision, reason: reason ?? null };
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

function extractCustomerRejectionReason(payload: any): string | null {
  if (!payload) return null;

  const direct = [
    payload?.rejection_reason,
    payload?.customer_rejection_reason,
    payload?.user_rejection_reason,
    payload?.reason,
    payload?.message,
  ].find((v) => typeof v === "string" && String(v).trim().length > 0);
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const rr = payload?.rejection_reasons;
  if (Array.isArray(rr)) {
    for (const item of rr) {
      const msg = item?.rejection_reason ?? item?.user_reason ?? item?.reason;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
  }
  return null;
}

/**
 * Best-effort transaction email for wallet activity credits/debits. NEVER
 * throws and is idempotent per Bridge event id.
 */
async function emailTransactionBestEffort(input: {
  userId: string;
  accountType: "individual" | "business";
  eventId: string;
  direction: "credit" | "debit";
  amount: number;
  currency: string;
  occurredAt?: string | null;
  description?: string | null;
}): Promise<void> {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(input.userId);
    if (!rcpt) return;

    if (input.accountType === "business") {
      const { data: biz } = await supabase
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", input.userId)
        .maybeSingle();
      const companyName = String(biz?.company_name || "Your business");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
        },
        body: JSON.stringify({
          template: "business.transaction_notification",
          to: rcpt.email,
          user_id: input.userId,
          idempotency_key: `wh:tx:${input.eventId}:business`,
          props: {
            company_name: companyName,
            direction: input.direction,
            amount: input.amount,
            currency: input.currency,
            reference: `bridge:${input.eventId}`,
            description: input.description || "Wallet activity",
            occurred_at: input.occurredAt ?? new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.log(`webhook-email transaction business send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
      }
      return;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template: "individual.transaction_notification",
        to: rcpt.email,
        user_id: input.userId,
        idempotency_key: `wh:tx:${input.eventId}:individual`,
        props: {
          full_name: rcpt.full_name,
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          reference: `bridge:${input.eventId}`,
          description: input.description || "Wallet activity",
          occurred_at: input.occurredAt ?? new Date().toISOString(),
        },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log(`webhook-email transaction individual send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email transaction best-effort error: ${(e as Error).message}`);
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
      bridge_kyb_status:      normalized,
      bridge_kyb_completed_at: normalized === "approved" ? new Date().toISOString() : null,
      updated_at:             new Date().toISOString(),
    }).eq("user_id", resolved);
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
    await ensureStablecoinWalletsProvisioned({
      userId: resolved,
      bridgeCustomerId: String(customer),
      accountType: isKyb || account_type === "business" ? "business" : "individual",
    });
  }

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: isKyb ? "kyc_link" : "customer", target_entity_id: String(customer) })
    .eq("event_id", ev.event_id);

  // Terminal KYC/KYB decision → best-effort email (approved/rejected only).
  if (normalized === "approved" || normalized === "rejected") {
    const customerReason = normalized === "rejected" ? extractCustomerRejectionReason(d) : null;
    await emailKycDecisionBestEffort(resolved, isKyb || account_type === "business", normalized, customerReason);
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

    await supabase.from("user_profiles")
      .update(update)
      .eq("bridge_customer_id", String(customer));

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
          const customerReason = canonicalKyc === "rejected" ? extractCustomerRejectionReason(d) : null;
          await emailKycDecisionBestEffort(
            owner.resolved, false,
            canonicalKyc === "verified" ? "approved" : "rejected",
            customerReason,
          );
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
const DEFAULT_VA_DEVELOPER_FEE_PERCENT = 2.5;
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

function normalizeDeveloperFeePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

let cachedCanonicalVaDeveloperFeePercent: number | null = null;
async function getCanonicalVaDeveloperFeePercent(): Promise<number> {
  if (cachedCanonicalVaDeveloperFeePercent !== null) return cachedCanonicalVaDeveloperFeePercent;
  const { data: setting } = await supabase
    .from("provider_settings")
    .select("value")
    .eq("key", "bridge.virtual_account.developer_fee_percent")
    .maybeSingle();
  cachedCanonicalVaDeveloperFeePercent =
    normalizeDeveloperFeePercent(setting?.value) ?? DEFAULT_VA_DEVELOPER_FEE_PERCENT;
  return cachedCanonicalVaDeveloperFeePercent;
}

async function upsertBridgeVirtualAccountProjection(params: {
  vaId: string;
  customer: string;
  payload: any;
  currency: string;
  existingFeePercent?: unknown;
}) {
  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(params.customer);
  const canonicalFee = await getCanonicalVaDeveloperFeePercent();
  const payloadFee =
    normalizeDeveloperFeePercent(params.payload?.developer_fee_percent) ??
    normalizeDeveloperFeePercent(params.payload?.virtual_account?.developer_fee_percent);
  const effectiveFee =
    payloadFee ??
    normalizeDeveloperFeePercent(params.existingFeePercent) ??
    canonicalFee;

  await supabase.from("bridge_virtual_accounts").upsert({
    bridge_virtual_account_id: String(params.vaId),
    bridge_customer_id:        String(params.customer),
    user_id:                   account_type === "individual" ? resolved : null,
    business_user_id:          account_type === "business"   ? resolved : null,
    currency:                  params.currency,
    rail:                      params.payload?.rail ?? params.payload?.payment_rail ?? null,
    account_details:           params.payload?.source_deposit_instructions ?? params.payload?.account_details ?? {},
    status:                    String(params.payload?.status ?? "active").toLowerCase(),
    developer_fee_percent:     effectiveFee,
    updated_at:                new Date().toISOString(),
  }, { onConflict: "bridge_virtual_account_id" });

  return { resolved, account_type, developer_fee_percent: effectiveFee };
}

async function handleBridgeVirtualAccount(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the virtual_account; event_object_id its id.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const vaId   = d?.virtual_account_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!vaId) throw new Error("bridge virtual_account event missing virtual_account_id");

  const payloadCustomer = d?.customer_id ?? d?.customer?.id;
  const { data: existingVa } = await supabase
    .from("bridge_virtual_accounts")
    .select("bridge_customer_id,developer_fee_percent")
    .eq("bridge_virtual_account_id", String(vaId))
    .maybeSingle();
  const customer = payloadCustomer ?? existingVa?.bridge_customer_id;
  if (!customer) throw new Error("bridge virtual_account event missing customer_id and VA mapping");

  const t = ev.event_type.toLowerCase();
  const isActivity = t.includes("activity") || t.includes("deposit") || t.includes("credit");
  const currency   = String(d?.currency ?? "USD").toUpperCase();
  const owner = await upsertBridgeVirtualAccountProjection({
    vaId: String(vaId),
    customer: String(customer),
    payload: d,
    currency,
    existingFeePercent: existingVa?.developer_fee_percent,
  });

  // Lifecycle event (created/updated/etc): projection already upserted above.
  if (!isActivity) {
    await supabase.from("bridge_webhook_events")
      .update({ target_entity_type: "virtual_account", target_entity_id: String(vaId) })
      .eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary:  { source: "bridge", kind: "virtual_account", virtual_account_id: vaId },
    });
    return;
  }

  // Activity / deposit / credit event.
  const amountMinor = toMinorUnits(d?.amount, currency);
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
                    skipped: "non_positive_amount", amount_minor: amountMinor.toString() },
    });
    return;
  }

  const { resolved, account_type } = owner;

  // Canonical Bridge balance + auditable ledger. Idempotent on event_id.
  const { data: creditResult, error: creditErr } = await supabase.rpc("apply_bridge_va_credit", {
    p_event_id:         ev.event_id,
    p_bridge_va_id:     String(vaId),
    p_user_id:          account_type === "individual" ? resolved : null,
    p_business_user_id: account_type === "business"   ? resolved : null,
    p_currency:         currency,
    // PostgREST serialises bigint via JSON — pass as string to avoid float coercion.
    p_amount_minor:     amountMinor.toString(),
    p_metadata: {
      source:           "bridge",
      virtual_account:  vaId,
      bridge_customer:  customer,
      developer_fee_percent: owner.developer_fee_percent,
      reference:        d?.reference ?? null,
      raw:              d,
    },
  });
  if (creditErr) {
    throw new Error(`apply_bridge_va_credit failed: ${creditErr.message}`);
  }
  const creditRow = Array.isArray(creditResult) ? creditResult[0] : creditResult;

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
      p_tx_metadata:  { virtual_account_id: vaId, bridge_reference: d?.reference ?? null, payload: d, mirror_of: "bridge_balance_ledger" },
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
  const shouldProjectWalletActivityTx =
    isActivity && Number.isFinite(amountValue) && amountValue > 0 && !!resolved;

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

  // Projection repair/prevention: wallet activity with amount should emit
  // canonical Bridge transaction + user notification idempotently.
  if (shouldProjectWalletActivityTx) {
    const txReference = `bridge:${ev.event_id}`;
    const currency = String(d?.currency ?? "USDC").toUpperCase();
    await supabase.from("transactions").upsert({
      user_id:     resolved,
      type:        "deposit",
      amount:      amountValue,
      currency,
      status:      "completed",
      reference:   txReference,
      metadata:    {
        source: "bridge",
        kind: "wallet_activity",
        bridge_event_id: ev.event_id,
        bridge_wallet_id: String(walletId),
        bridge_customer_id: String(customer),
        raw: d,
      },
      provider:    "bridge",
      description: "Wallet deposit credit",
      updated_at:  new Date().toISOString(),
    }, { onConflict: "reference" });

    const { data: existingNotification } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", resolved)
      .eq("type", "transaction")
      .contains("metadata", { bridge_event_id: ev.event_id })
      .maybeSingle();
    if (!existingNotification?.id) {
      await supabase.from("notifications").insert({
        user_id: resolved,
        type: "transaction",
        title: "Deposit received",
        body: `Received ${amountValue} ${currency} via account activity.`,
        metadata: {
          bridge_event_id: ev.event_id,
          bridge_wallet_id: String(walletId),
          amount: amountValue,
          currency,
          source: "bridge",
        },
      });
    }

    const amountMinor = toMinorUnits(d?.amount, currency);
    if (amountMinor !== null) {
      await supabase.from("bridge_balance_ledger").upsert({
        event_id: ev.event_id,
        provider: "bridge",
        entity_type: "wallet",
        entity_id: String(walletId),
        user_id: account_type === "individual" ? resolved : null,
        business_user_id: account_type === "business" ? resolved : null,
        currency,
        amount_minor: amountMinor.toString(),
        direction: amountMinor >= 0n ? "credit" : "debit",
        metadata: {
          source: "bridge",
          kind: "wallet_activity",
          bridge_event_id: ev.event_id,
          bridge_wallet_id: String(walletId),
          bridge_customer_id: String(customer),
          raw: d,
        },
      }, { onConflict: "event_id", ignoreDuplicates: true });
    }

    const direction = amountValue >= 0 ? "credit" : "debit";
    await emailTransactionBestEffort({
      userId: resolved,
      accountType: account_type === "business" ? "business" : "individual",
      eventId: ev.event_id,
      direction,
      amount: Math.abs(amountValue),
      currency,
      occurredAt: String(d?.created_at ?? d?.occurred_at ?? d?.timestamp ?? ""),
      description: "Wallet deposit credit",
    });
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

  const sourceType = String(d?.source?.type ?? d?.source?.payment_rail ?? "external_bank");
  const destType   = String(d?.destination?.type ?? d?.destination?.payment_rail ?? "external_bank");
  const normSource = ["virtual_account","wallet","external_bank","external_wallet"].includes(sourceType) ? sourceType : "external_bank";
  const normDest   = ["virtual_account","wallet","external_bank","external_wallet"].includes(destType)   ? destType   : "external_bank";

  const amount   = Number(d?.amount ?? 0);
  const currency = String(d?.currency ?? d?.source?.currency ?? "USD").toUpperCase();

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
        transaction_type: "fx_conversion",
        flow:             "stablecoin_sandwich",
        account_type:     owner.account_type,
        source_type:      normSource,
        destination_type: normDest,
        bridge_state:     mappedState.providerState,
        bridge_state_recognized: mappedState.recognized,
        raw:              d,
      },
    });
    if (txErr) {
      throw new Error(`upsert_bridge_transaction failed: ${txErr.message}`);
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
  const { data: operatorRow } = await supabase
    .from("operator_bridge_accounts")
    .select("bridge_customer_id")
    .eq("bridge_customer_id", input.bridgeCustomerId)
    .eq("active", true)
    .maybeSingle();
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
  if (String(profile?.[statusCol] || "").toLowerCase() !== "approved") return;

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
      .select("country, phone, bridge_address_object")
      .eq("id", owner.resolved)
      .maybeSingle(),
    owner.account_type === "business"
      ? supabase
          .from("business_profiles")
          .select("country, company_phone, address, city, state, postal_code")
          .eq("user_id", owner.resolved)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);

  const userCountry = normalizeCountryCode(userProfile?.country);
  const businessCountry = normalizeCountryCode(businessProfile?.country);
  if (userCountry && (owner.account_type !== "business" || businessCountry)) return;

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
  if (!bridgeCountry) return;

  const userUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (!userCountry) userUpdate.country = bridgeCountry;
  if (!userProfile?.phone && customer.phone) userUpdate.phone = customer.phone;
  if (customer.address_object && Object.values(customer.address_object).some((v) => String(v ?? "").trim().length > 0)) {
    userUpdate.bridge_address_object = customer.address_object;
    if (!userProfile?.country) userUpdate.country = bridgeCountry;
    const line1 = customer.address_object.street_line_1;
    const line2 = customer.address_object.street_line_2;
    if (line1) userUpdate.address = line2 ? `${line1}, ${line2}` : line1;
    if (customer.address_object.city) userUpdate.city = customer.address_object.city;
    if (customer.address_object.postal_code) userUpdate.postal_code = customer.address_object.postal_code;
  }
  await supabase.from("user_profiles").update(userUpdate).eq("id", owner.resolved);

  if (owner.account_type === "business") {
    const bizUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (!businessCountry) bizUpdate.country = bridgeCountry;
    if (!businessProfile?.company_phone && customer.phone) bizUpdate.company_phone = customer.phone;
    if (customer.address_object?.street_line_1 && !businessProfile?.address) {
      const line1 = customer.address_object.street_line_1;
      const line2 = customer.address_object.street_line_2;
      bizUpdate.address = line2 ? `${line1}, ${line2}` : line1;
    }
    if (customer.address_object?.city && !businessProfile?.city) bizUpdate.city = customer.address_object.city;
    if (customer.address_object?.state && !businessProfile?.state) bizUpdate.state = customer.address_object.state;
    if (customer.address_object?.postal_code && !businessProfile?.postal_code) bizUpdate.postal_code = customer.address_object.postal_code;
    await supabase.from("business_profiles").update(bizUpdate).eq("user_id", owner.resolved);
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
      ok: true,
      mode: "insert_webhook_drain",
      requested_event_id: eventId,
      ...result,
    }), { status: 200 });
  }

  // Path 2: drain mode (pg_cron / manual ops).
  const batch = Math.min(Number(body?.batch_size ?? 25), 100);
  const result = await drain(batch);
  return new Response(JSON.stringify({ ok: true, worker: WORKER_ID, ...result }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
