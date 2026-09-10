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
 */ import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { bridgeAutomaticWalletsForCountry, isBridgeBlocked, isBridgeCustodialWalletSupported, normalizeBridgeCountryCode } from "../_shared/providers/bridge-country-policy.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";
import { bridgeReceiptBreakdown } from "../_shared/bridge-receipt-breakdown.ts";
import { bridgeOperatorEventState, shouldNotifyBridgeOperator } from "../_shared/bridge-operator-notification.ts";
import { assertBridgeIngressDecision, evaluateBridgeIngressEvent } from "../_shared/bridge-ingress-evaluator.ts";
import { loadBridgeEeaWalletSecurityEnrollment } from "../_shared/wallet-security-enrollment.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PROCESS_PENDING_EVENTS_WORKER_TOKEN = Deno.env.get("PROCESS_PENDING_EVENTS_WORKER_TOKEN") ?? "";
const SYNTHETIC_EVENTS_ENABLED = (Deno.env.get("SYNTHETIC_EVENTS_ENABLED") ?? "false").toLowerCase() === "true";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let different = a.length ^ b.length;
  for(let index = 0; index < length; index += 1)different |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return different === 0;
}
function isAuthorizedWorkerRequest(req) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return Boolean(PROCESS_PENDING_EVENTS_WORKER_TOKEN && timingSafeEqual(token, PROCESS_PENDING_EVENTS_WORKER_TOKEN) || SUPABASE_SERVICE_ROLE && timingSafeEqual(token, SUPABASE_SERVICE_ROLE));
}
// ── Webhook-email ────────────────────────────────────────────────────────────
// All sends route through the logged `send-email` function (Brevo transport) and
// are BEST-EFFORT: an email failure must never fail webhook processing.
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const OPERATOR_TRANSACTION_EMAILS = Array.from(new Set(String(Deno.env.get("OPERATOR_TRANSACTION_NOTIFICATION_EMAILS") ?? "").split(",").map((value)=>value.trim().toLowerCase()).filter(Boolean)));
const ADMIN_COMPLIANCE_URL = String(Deno.env.get("ADMIN_COMPLIANCE_URL") ?? "").trim();
// Suppression config (DB/env only — never decided from the webhook payload).
// An UNSET env var keeps the default; an explicitly empty value disables it
// (e.g. to allow an operator smoke test).
function envList(name, fallback) {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  return raw.split(",").map((s)=>s.trim().toLowerCase()).filter(Boolean);
}
const EMAIL_SUPPRESS_LIST = ()=>envList("WEBHOOK_EMAIL_SUPPRESS_LIST", []);
const EMAIL_SUPPRESS_DOMAINS = ()=>envList("WEBHOOK_EMAIL_SUPPRESS_DOMAINS", [
    "borderpayafrica.com"
  ]);
/**
 * Resolve the email recipient for a mapped user, applying the suppression
 * predicate entirely from DB + env (never the webhook payload). Returns null
 * when the email must be suppressed: no user, no/absent email, is_admin,
 * suppress-list, suppress-domain, or unconfirmed email.
 */ async function resolveEmailRecipient(userId) {
  if (!userId) return null;
  const { data: prof } = await supabase.from("user_profiles").select("email, is_admin, full_name").eq("id", userId).maybeSingle();
  const email = prof?.email ? String(prof.email).trim() : "";
  if (!email) return null;
  if (prof?.is_admin === true) return null;
  const lower = email.toLowerCase();
  const domain = lower.split("@")[1] ?? "";
  if (EMAIL_SUPPRESS_LIST().includes(lower)) return null;
  if (EMAIL_SUPPRESS_DOMAINS().includes(domain)) return null;
  // Email confirmation lives in auth.users (not user_profiles). Skip unconfirmed.
  const { data: au } = await supabase.auth.admin.getUserById(userId);
  if (!au?.user?.email_confirmed_at) return null;
  return {
    email,
    full_name: prof?.full_name ?? null
  };
}
/**
 * Best-effort terminal KYC/KYB decision email. NEVER throws — a failure is
 * logged and swallowed so webhook processing still completes. Recipient +
 * suppression are resolved from DB/env. Idempotency is keyed on the user,
 * template, and terminal decision so a kyc_link.* decision plus the matching
 * customer.* terminal status collapse into one customer email.
 */ async function emailKycDecisionBestEffort(userId, isKyb, decision) {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(userId);
    if (!rcpt) return;
    let template;
    let props;
    if (isKyb) {
      const { data: biz } = await supabase.from("business_profiles").select("company_name").eq("user_id", userId).maybeSingle();
      template = "business.kyb_decision";
      props = {
        company_name: biz?.company_name ?? null,
        decision
      };
    } else {
      template = "individual.kyc_decision";
      props = {
        full_name: rcpt.full_name,
        decision
      };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: userId,
        idempotency_key: `wh:kyc:${userId}:${template}:${decision}`,
        props
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      console.log(`webhook-email kyc/kyb send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email kyc/kyb best-effort error: ${e.message}`);
  }
}
/**
 * Notify a customer when Bridge places the account into its paused state.
 * send-email owns the delivery log and idempotency record, so a retried
 * customer.updated webhook cannot produce duplicate customer messages.
 */ async function emailAccountPausedBestEffort(userId, accountType, bridgeCustomerId, pausedAt) {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(userId);
    if (!rcpt) return;
    const isBusiness = accountType === "business";
    let companyName = null;
    if (isBusiness) {
      const { data: biz } = await supabase.from("business_profiles").select("company_name").eq("user_id", userId).maybeSingle();
      companyName = biz?.company_name ?? null;
    }
    const template = isBusiness ? "business.account_suspended" : "individual.account_suspended";
    const props = isBusiness ? {
      full_name: rcpt.full_name,
      company_name: companyName,
      reason_public: "Your business account is temporarily restricted while we complete a review."
    } : {
      full_name: rcpt.full_name,
      reason_public: "Your account is temporarily restricted while we complete a review."
    };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: userId,
        idempotency_key: `wh:account-paused:${bridgeCustomerId}:${pausedAt}`,
        props
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      console.log(`webhook-email account-paused send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email account-paused best-effort error: ${e.message}`);
  }
}
async function emailTransactionStatusBestEffort(params) {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;
    const template = params.accountType === "business" ? "business.transaction_status" : "individual.transaction_status";
    let props = {
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
      destination_rail: params.destinationRail ?? null,
      source_rail: params.sourceRail ?? null,
      deposit_id: params.depositId ?? null,
      receipt_kind: params.receiptKind ?? null,
      refund_return_reason: params.refundReturnReason ?? null,
      refund_returned_at: params.refundReturnedAt ?? null,
      refund_risk_rejection_reason: params.refundRiskRejectionReason ?? null,
      refund_rail: params.refundRail ?? null,
      refund_beneficiary_name: params.refundBeneficiaryName ?? null,
      refund_reference_id: params.refundReferenceId ?? null,
      source_bank_name: params.sourceBankName ?? null,
      source_bank_account: params.sourceBankAccount ?? null,
      payment_reference_text: params.paymentReferenceText ?? null,
      receiving_bank_name: params.receivingBankName ?? null,
      receiving_account_name: params.receivingAccountName ?? null,
      receiving_account_number: params.receivingAccountNumber ?? null,
      trace_id: params.traceId ?? null,
      imad: params.imad ?? null,
      uetr: params.uetr ?? null,
      clave_de_rastreo: params.claveDeRastreo ?? null
    };
    if (params.accountType === "business") {
      const { data: biz } = await supabase.from("business_profiles").select("company_name").eq("user_id", params.userId).maybeSingle();
      props = {
        ...props,
        company_name: biz?.company_name ?? null
      };
    } else {
      props = {
        ...props,
        full_name: rcpt.full_name
      };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: params.idempotencyKey,
        props
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      console.log(`webhook-email transaction-status send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email transaction-status best-effort error: ${e.message}`);
  }
}
async function emailWalletActivityBestEffort(params) {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;
    const template = params.accountType === "business" ? "business.transaction_notification" : "individual.transaction_notification";
    let props = {
      direction: params.direction,
      amount: params.amount,
      currency: params.currency,
      reference: params.reference,
      description: params.description ?? null,
      occurred_at: params.occurredAt ?? null,
      new_balance: params.newBalance ?? null
    };
    if (params.accountType === "business") {
      const { data: biz } = await supabase.from("business_profiles").select("company_name").eq("user_id", params.userId).maybeSingle();
      props = {
        ...props,
        company_name: biz?.company_name ?? null
      };
    } else {
      props = {
        ...props,
        full_name: rcpt.full_name
      };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: params.idempotencyKey,
        props
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      console.log(`webhook-email wallet-activity send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email wallet-activity best-effort error: ${e.message}`);
  }
}
async function emailGlobalAccountReadyBestEffort(params) {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;
    let template;
    let props;
    if (params.accountType === "business") {
      const { data: biz } = await supabase.from("business_profiles").select("company_name").eq("user_id", params.userId).maybeSingle();
      template = "business.account_ready";
      props = {
        company_name: biz?.company_name ?? null,
        product: "virtual_account",
        outcome: "provisioned",
        currency: params.currency
      };
    } else {
      template = "individual.account_ready";
      props = {
        full_name: rcpt.full_name,
        product: "virtual_account",
        outcome: "provisioned",
        currency: params.currency
      };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: `wh:va-ready:${params.userId}:${params.virtualAccountId}:${params.currency}`,
        props
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      console.log(`webhook-email global-account-ready send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email global-account-ready best-effort error: ${e.message}`);
  }
}
async function emailVirtualAccountLimitsBestEffort(params) {
  try {
    if (!SEND_EMAIL_TOKEN) return;
    const rcpt = await resolveEmailRecipient(params.userId);
    if (!rcpt) return;
    const { data: vaRows } = await supabase.from("bridge_virtual_accounts").select("currency,rail,status,account_details").or(`user_id.eq.${params.userId},business_user_id.eq.${params.userId}`).eq("status", "active").in("currency", [
      "USD",
      "EUR",
      "GBP"
    ]);
    const virtualAccounts = (vaRows || []).map((row)=>{
      const currency = String(row.currency || "").toUpperCase();
      const accountDetails = row.account_details && typeof row.account_details === "object" ? row.account_details : {};
      const source = accountDetails.source_deposit_instructions && typeof accountDetails.source_deposit_instructions === "object" ? accountDetails.source_deposit_instructions : {};
      const railRaw = String(row.rail || source.payment_rail || (Array.isArray(source.payment_rails) ? source.payment_rails[0] : "") || "").toLowerCase();
      const rail = railRaw === "ach" || railRaw === "ach_push" ? "ACH / Wire / FedNow" : railRaw === "sepa" ? "SEPA" : railRaw === "faster_payments" ? "Faster Payments" : currency === "USD" ? "ACH / Wire / FedNow" : currency === "EUR" ? "SEPA" : currency === "GBP" ? "Faster Payments" : "Bank transfer";
      if (currency === "USD") {
        return {
          currency,
          rail,
          account_label: `${currency} - ${rail}`,
          minimum: "No published minimum",
          maximum: "No published standard maximum",
          accepted_payments: "Own-account payments, business payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000.",
          important_note: "USD person-to-person payments must stay under $4,000 and are not supported from New York or Texas."
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
          important_note: "Individual third-party EUR SEPA payments need support review before use. Contact us first to avoid a preventable refund."
        };
      }
      return {
        currency,
        rail,
        account_label: `${currency} - ${rail}`,
        minimum: "No published minimum",
        maximum: "No published standard maximum. Payments over GBP 1,000,000 use BACS and may take 3 business days.",
        accepted_payments: "Own-account payments and business payments are supported.",
        important_note: "GBP does not support incoming payments from individuals. Use GBP for company, employer, platform, or client business payments only."
      };
    });
    const template = params.accountType === "business" ? "business.virtual_account_limits" : "individual.virtual_account_limits";
    let props = {
      full_name: rcpt.full_name,
      virtual_accounts: virtualAccounts,
      action_url: `${Deno.env.get("APP_URL") || "https://app.borderpayafrica.com"}/dashboard`
    };
    if (params.accountType === "business") {
      const { data: biz } = await supabase.from("business_profiles").select("company_name").eq("user_id", params.userId).maybeSingle();
      props = {
        ...props,
        company_name: biz?.company_name ?? null
      };
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`
      },
      body: JSON.stringify({
        template,
        to: rcpt.email,
        user_id: params.userId,
        idempotency_key: `wh:verified-account-limits:${params.userId}:${params.bridgeCustomerId}:v1`,
        props
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      console.log(`webhook-email virtual-account-limits send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`webhook-email virtual-account-limits best-effort error: ${e.message}`);
  }
}
function isFinancialOperatorEvent(ev) {
  const decision = evaluateBridgeIngressEvent({
    source: "bridge",
    eventIdRaw: "operator-notification-classifier",
    eventTypeRaw: ev.event_type,
    payload: ev.payload,
    signatureOk: true,
    replayWindowOk: true,
    parseOk: true
  });
  if (![
    "bridge.transfer",
    "bridge.liquidation_address",
    "bridge.virtual_account"
  ].includes(decision.route_bucket)) return false;
  return shouldNotifyBridgeOperator({
    eventType: ev.event_type,
    payload: ev.payload
  });
}
/**
 * Sends one deduplicated operator email for each processed financial provider
 * event. This runs only after the canonical handler succeeds. Email failure is
 * visible in operator_provider_event_notifications but never rolls back the
 * financial webhook projection.
 */ async function emailOperatorTransactionEventBestEffort(ev) {
  if (!SEND_EMAIL_TOKEN || OPERATOR_TRANSACTION_EMAILS.length === 0 || !isFinancialOperatorEvent(ev)) return;
  const eventObject = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const customerId = firstNonEmptyText(eventObject?.customer_id, eventObject?.customer?.id, eventObject?.source?.customer_id, eventObject?.destination?.customer_id);
  const resourceId = firstNonEmptyText(eventObject?.transfer_id, eventObject?.deposit_id, eventObject?.id, ev.payload?.event_object_id);
  const receipt = objectValue(eventObject?.receipt) ?? {};
  const amount = firstFiniteNumber(eventObject?.amount, receipt.initial_amount, receipt.source_amount, receipt.final_amount);
  const currency = firstNonEmptyText(eventObject?.currency, eventObject?.source?.currency, receipt.source_currency, eventObject?.destination?.currency)?.toUpperCase() ?? null;
  const state = bridgeOperatorEventState(ev.payload) ?? "unknown";
  let owner = {
    resolved: null,
    account_type: null
  };
  if (customerId) {
    try {
      owner = await resolveOwnerFromBridgeCustomer(customerId);
    } catch  {
    // An unmapped provider customer is itself useful operator evidence. The
    // notification remains valid and explicitly says "unmapped".
    }
  }
  await Promise.all(OPERATOR_TRANSACTION_EMAILS.map(async (recipient)=>{
    try {
      const { error: claimError } = await supabase.from("operator_provider_event_notifications").insert({
        provider: "bridge",
        provider_event_id: ev.event_id,
        event_type: ev.event_type,
        recipient,
        channel: "email",
        status: "queued",
        provider_resource_id: resourceId,
        user_id: owner.resolved,
        metadata: {
          customer_id: customerId,
          amount,
          currency,
          state
        }
      });
      if (claimError) {
        if (claimError.code === "23505") return;
        throw claimError;
      }
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SEND_EMAIL_TOKEN}`
        },
        body: JSON.stringify({
          template: "admin.provider_transaction_event",
          to: recipient,
          user_id: owner.resolved,
          idempotency_key: `operator:bridge:${ev.event_id}:${recipient}`,
          props: {
            provider: "bridge",
            event_type: ev.event_type,
            event_id: ev.event_id,
            resource_id: resourceId,
            customer_id: customerId,
            user_id: owner.resolved,
            amount,
            currency,
            state,
            occurred_at: firstNonEmptyText(eventObject?.updated_at, eventObject?.created_at, ev.payload?.event_created_at),
            admin_url: ADMIN_COMPLIANCE_URL || undefined
          }
        })
      });
      const responseBody = await response.json().catch(()=>({}));
      if (!response.ok || responseBody?.success === false) {
        throw new Error(String(responseBody?.error || `send-email failed (${response.status})`));
      }
      await supabase.from("operator_provider_event_notifications").update({
        status: responseBody?.data?.deduped ? "deduped" : "sent",
        sent_at: new Date().toISOString(),
        last_error: null
      }).eq("provider", "bridge").eq("provider_event_id", ev.event_id).eq("recipient", recipient).eq("channel", "email");
    } catch (error) {
      console.error(`operator transaction email failed event=${ev.event_id} recipient=${recipient}: ${error.message}`);
      await supabase.from("operator_provider_event_notifications").update({
        status: "failed",
        last_error: error.message.slice(0, 1000)
      }).eq("provider", "bridge").eq("provider_event_id", ev.event_id).eq("recipient", recipient).eq("channel", "email");
    }
  }));
}
const PROVISIONING_LOCK_STALE_SECONDS = 180;
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function provisioningLockEventId(customerId, symbol, chain) {
  return `provlock:wallet:${customerId}:${symbol.toUpperCase()}:${chain.toLowerCase()}`;
}
async function tryAcquireProvisioningLock(customerId, symbol, chain) {
  const lockEventId = provisioningLockEventId(customerId, symbol, chain);
  const nowIso = new Date().toISOString();
  const payloadHash = await sha256Hex(lockEventId);
  const marker = `worker=${WORKER_ID};symbol=${symbol};chain=${chain.toLowerCase()}`;
  const { error: insertErr } = await supabase.from("webhook_logs").insert({
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
    completed_at: null
  });
  if (!insertErr) return {
    state: "acquired",
    lockEventId
  };
  // 23505 = unique violation (event_id already exists).
  if (insertErr?.code !== "23505") {
    throw new Error(`provisioning lock insert failed: ${insertErr.message}`);
  }
  const { data: row, error: readErr } = await supabase.from("webhook_logs").select("status, received_at, attempts").eq("event_id", lockEventId).maybeSingle();
  if (readErr) throw new Error(`provisioning lock read failed: ${readErr.message}`);
  const status = String(row?.status || "").toLowerCase();
  // If another worker currently holds this lock, don't compete.
  const receivedAt = row?.received_at ? new Date(String(row.received_at)) : new Date(0);
  const staleBefore = new Date(Date.now() - PROVISIONING_LOCK_STALE_SECONDS * 1000);
  if (status === "processing" && receivedAt > staleBefore) {
    return {
      state: "busy",
      lockEventId
    };
  }
  // The caller checks the canonical bridge_wallets row before acquiring this
  // lock. A completed/failed lock with no active wallet is therefore stale
  // coordination state and must be reopened immediately. Previously every
  // non-processing row was also subjected to the 180-second stale threshold;
  // the queue retried sooner, interpreted the failed lock as busy, and then
  // completed the KYB event without provisioning either wallet.
  const staleIso = staleBefore.toISOString();
  const attempts = Number(row?.attempts || 0) + 1;
  let takeover = supabase.from("webhook_logs").update({
    status: "processing",
    attempts,
    last_error: `${marker};state=takeover`,
    received_at: nowIso,
    queued_at: nowIso,
    completed_at: null
  }).eq("event_id", lockEventId).eq("status", status || "failed");
  if (status === "processing") takeover = takeover.lte("received_at", staleIso);
  const { data: taken, error: takeoverErr } = await takeover.select("event_id").maybeSingle();
  if (takeoverErr) throw new Error(`provisioning lock takeover failed: ${takeoverErr.message}`);
  if (taken?.event_id) return {
    state: "stale_acquired",
    lockEventId
  };
  return {
    state: "busy",
    lockEventId
  };
}
async function completeProvisioningLock(lockEventId, note) {
  await supabase.from("webhook_logs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    last_error: note.slice(0, 512)
  }).eq("event_id", lockEventId);
}
async function failProvisioningLock(lockEventId, errorText) {
  await supabase.from("webhook_logs").update({
    status: "failed",
    last_error: errorText.slice(0, 512),
    completed_at: null
  }).eq("event_id", lockEventId);
}
// ── Top-level router (source-aware) ──────────────────────────────────────
//
// BorderPay has one active provider path in this worker. Unknown source values
// are terminally completed without side effects (fail-closed, never fall
// through).
async function processEvent(ev) {
  switch(ev.source){
    case "bridge":
      {
        const decision = evaluateBridgeIngressEvent({
          source: "bridge",
          eventIdRaw: ev.event_id,
          eventTypeRaw: ev.event_type,
          payload: ev.payload,
          signatureOk: true,
          replayWindowOk: true,
          parseOk: true
        });
        return await processBridgeEvent(ev, decision);
      }
    case "bridge_test":
      if (!SYNTHETIC_EVENTS_ENABLED) {
        await supabase.rpc("complete_pending_event", {
          p_event_id: ev.event_id,
          p_summary: {
            source: "bridge_test",
            skipped: "synthetic_mode_disabled"
          }
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
        parseOk: true
      }));
    default:
      // Unknown source — fail closed.
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary: {
          unknown_source: ev.source ?? null,
          event_type: ev.event_type
        }
      });
      return;
  }
}
// ── Bridge event router ──────────────────────────────────────────────────
async function processBridgeEvent(ev, ingress) {
  assertBridgeIngressDecision(ingress);
  if (SYNTHETIC_EVENTS_ENABLED && ev.payload?.test_origin === true) {
    const syntheticDecision = evaluateBridgeIngressEvent({
      source: "bridge_test",
      eventIdRaw: ev.event_id,
      eventTypeRaw: ev.event_type,
      payload: ev.payload,
      signatureOk: true,
      replayWindowOk: true,
      parseOk: true
    });
    return await processBridgeTestEvent(ev, syntheticDecision);
  }
  switch(ingress.route_bucket){
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
    case "bridge.liquidation_address":
      return await handleBridgeLiquidationDrain(ev);
    case "bridge.customer":
      return await handleBridgeCustomerStatus(ev);
    default:
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary: {
          source: "bridge",
          unknown_event_type: ingress.derived_event_type,
          reason_code: ingress.reason_code
        }
      });
      return;
  }
}
// ── Synthetic Bridge-test router (dry-run only, no financial writes) ────────
function syntheticForceFail(ev) {
  const ctrl = ev.payload?.test_control ?? {};
  return ctrl?.force_fail === true || ev.payload?.force_fail === true;
}
function syntheticEnvelope(ev) {
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  return {
    source: "bridge_test",
    dry_run: true,
    event_type: ev.event_type,
    event_id: ev.event_id,
    replay_group_key: ev.payload?.replay_group_key ?? null,
    test_case_id: ev.payload?.test_case_id ?? null,
    bridge_event_id: ev.payload?.bridge_event_id ?? null,
    event_object_id: d?.id ?? d?.transfer_id ?? d?.wallet_id ?? d?.virtual_account_id ?? d?.external_account_id ?? null,
    customer_id: d?.customer_id ?? d?.customer?.id ?? null
  };
}
async function processBridgeTestEvent(ev, ingress) {
  assertBridgeIngressDecision(ingress);
  if (syntheticForceFail(ev)) {
    throw new Error("synthetic_forced_failure");
  }
  const t = ingress.derived_event_type.toLowerCase();
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const base = syntheticEnvelope(ev);
  if (ingress.route_bucket === "bridge.kyc") {
    const status = String(d?.status ?? d?.kyc_status ?? ev.payload?.event_object_status ?? "").toLowerCase() || "pending";
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeKycKyb",
        intended_write_tables: [
          "user_profiles",
          "business_profiles",
          "bridge_webhook_events"
        ],
        normalized_status: status,
        financial_write_blocked: true
      }
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
        intended_write_tables: isActivity ? [
          "bridge_virtual_account_balances",
          "bridge_balance_ledger",
          "wallets",
          "transactions",
          "bridge_webhook_events"
        ] : [
          "bridge_virtual_accounts",
          "bridge_webhook_events"
        ],
        event_branch: isActivity ? "activity" : "lifecycle",
        financial_write_blocked: true
      }
    });
    return;
  }
  if (ingress.route_bucket === "bridge.wallet") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeWallet",
        intended_write_tables: [
          "bridge_wallets",
          "bridge_webhook_events"
        ],
        financial_write_blocked: true
      }
    });
    return;
  }
  if (ingress.route_bucket === "bridge.external_account") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeExternalAccount",
        intended_write_tables: [
          "bridge_external_accounts"
        ],
        recognized_event: t.endsWith(".created") || t.endsWith(".updated") || t.endsWith(".deleted"),
        financial_write_blocked: true
      }
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
        intended_write_tables: [
          "bridge_transfers",
          "transactions",
          "bridge_webhook_events"
        ],
        provider_state: mapped.providerState,
        internal_state: mapped.transactionStatus,
        provider_state_recognized: mapped.recognized,
        financial_write_blocked: true
      }
    });
    return;
  }
  if (ingress.route_bucket === "bridge.liquidation_address") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeLiquidationDrain",
        intended_write_tables: [
          "provider_revenue_events",
          "bridge_webhook_events"
        ],
        financial_write_blocked: true
      }
    });
    return;
  }
  if (ingress.route_bucket === "bridge.customer") {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        ...base,
        simulated_handler: "handleBridgeCustomerStatus",
        intended_write_tables: [
          "user_profiles",
          "business_profiles",
          "bridge_webhook_events",
          "bridge_wallets"
        ],
        financial_write_blocked: true
      }
    });
    return;
  }
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      ...base,
      unknown_event_type: t,
      financial_write_blocked: true
    }
  });
}
// ── Bridge handlers ──────────────────────────────────────────────────────
async function handleBridgeKycKyb(ev) {
  // Bridge webhook envelope is flat: { event_type, event_category,
  // event_object_id, event_object, event_object_status, ... }. The entity is
  // event_object (holds id / customer_id / status / currency / amount / etc.);
  // event_object_id is the entity's own id and event_object_status its status.
  // Fall back to a { data: ... } wrapper / bare payload for legacy/test shapes.
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const customer = d?.customer_id ?? d?.customer?.id ?? d?.id ?? ev.payload?.event_object_id;
  if (!customer) throw new Error("bridge kyc/kyb event missing customer id");
  const isKyb = ev.event_type.toLowerCase().includes("kyb") || d?.account_type === "business" || d?.type === "business";
  const status = String(d?.status ?? d?.kyc_status ?? ev.payload?.event_object_status ?? "").toLowerCase();
  const normalized = status === "approved" || status === "verified" ? "approved" : status === "rejected" || status === "denied" ? "rejected" : status === "under_review" ? "under_review" : status === "incomplete" ? "incomplete" : status === "not_started" ? "not_started" : status === "awaiting_ubo" ? "under_review" : status === "pending" ? "pending" : null;
  // Unknown/missing KYC-link states must never manufacture a pending review.
  // Preserve the existing profile and complete the event for observability.
  if (!normalized) {
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: isKyb ? "kyc_link" : "customer",
      target_entity_id: String(customer)
    }).eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: isKyb ? "kyb" : "kyc",
        status: status || null,
        ignored_unknown_status: true
      }
    });
    return;
  }
  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(customer);
  await syncCountryFromBridgeCustomer(String(customer), {
    resolved,
    account_type: isKyb || account_type === "business" ? "business" : "individual"
  });
  if (isKyb || account_type === "business") {
    await supabase.from("business_profiles").update({
      bridge_customer_id: String(customer),
      bridge_kyb_status: normalized,
      bridge_kyb_completed_at: normalized === "approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("user_id", resolved);
    await supabase.from("user_profiles").update({
      bridge_customer_id: String(customer),
      kyc_status: normalized === "approved" ? "verified" : normalized === "rejected" ? "rejected" : normalized === "not_started" ? "unverified" : "pending",
      updated_at: new Date().toISOString()
    }).eq("id", resolved);
  } else {
    await supabase.from("user_profiles").update({
      bridge_kyc_status: normalized,
      bridge_kyc_completed_at: normalized === "approved" ? new Date().toISOString() : null,
      kyc_status: normalized === "approved" ? "verified" : normalized === "rejected" ? "rejected" : normalized === "not_started" ? "unverified" : "pending",
      updated_at: new Date().toISOString()
    }).eq("id", resolved);
  }
  // Product requirement: auto-provision stablecoin wallets after approval.
  // Any failure must surface so the queue retries safely with idempotent keys.
  if (normalized === "approved") {
    const approvedAccountType = isKyb || account_type === "business" ? "business" : "individual";
    await ensureStablecoinWalletsProvisioned({
      userId: resolved,
      bridgeCustomerId: String(customer),
      accountType: approvedAccountType
    });
    await emailVirtualAccountLimitsBestEffort({
      userId: resolved,
      bridgeCustomerId: String(customer),
      accountType: approvedAccountType
    });
    await supabase.rpc("apply_card_waitlist_referral_approval", {
      p_event_id: ev.event_id,
      p_referred_id: resolved,
      p_spots: 500,
      p_metadata: {
        source: "bridge",
        kind: isKyb ? "kyb" : "kyc",
        bridge_customer_id: String(customer),
        bridge_status: normalized
      }
    });
  }
  await supabase.from("bridge_webhook_events").update({
    target_entity_type: isKyb ? "kyc_link" : "customer",
    target_entity_id: String(customer)
  }).eq("event_id", ev.event_id);
  // Terminal KYC/KYB decision → best-effort email (approved/rejected only).
  // Approved accounts now receive the subscription-aware verification email
  // from the database transition trigger. Keep this legacy template only for
  // rejected decisions so users never receive duplicate approval messages.
  if (normalized === "rejected") {
    await emailKycDecisionBestEffort(resolved, isKyb || account_type === "business", normalized);
  }
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: isKyb ? "kyb" : "kyc",
      status: normalized
    }
  });
}
async function handleBridgeCustomerStatus(ev) {
  // Bridge envelope: event_object is the customer; event_object_id is the
  // customer id; event_object_status its status. (See handleBridgeKycKyb.)
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const customer = d?.customer_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!customer) throw new Error("bridge customer event missing id");
  const accountStatus = String(d?.status ?? d?.account_status ?? ev.payload?.event_object_status ?? "").toLowerCase();
  if (accountStatus) {
    const { data: previousProfile } = await supabase.from("user_profiles").select("id,account_type,bridge_account_status").eq("bridge_customer_id", String(customer)).maybeSingle();
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
    const canonicalKyc = accountStatus === "active" ? "verified" : accountStatus === "rejected" ? "rejected" : null; // non-terminal → leave canonical kyc_status untouched
    const update = {
      bridge_account_status: accountStatus,
      bridge_verification_status: accountStatus || null,
      updated_at: new Date().toISOString()
    };
    // A pause is an account-access hold, not a KYC rejection. Persist Bridge's
    // transition time separately so every paused customer sees the correct date.
    // Clear it as soon as Bridge moves the customer out of `paused`.
    const pausedAt = String(ev.payload?.event_created_at ?? d?.updated_at ?? new Date().toISOString());
    update.bridge_account_paused_at = accountStatus === "paused" ? pausedAt : null;
    if (canonicalKyc) update.kyc_status = canonicalKyc;
    // Persist the customer's contact details Bridge sends on the customer event
    // (phone + residential address) so Profile → Personal information is filled,
    // not empty. Only overwrite when Bridge actually provides a value.
    const addr = d?.residential_address ?? d?.address ?? {};
    const phone = d?.phone ?? d?.phone_number;
    if (phone) update.phone = String(phone);
    const street = addr?.street_line_1 ?? addr?.street_line1 ?? addr?.line1 ?? addr?.street ?? "";
    const street2 = addr?.street_line_2 ?? addr?.street_line2 ?? "";
    const normalizedAddress = {
      street_line_1: street || null,
      street_line_2: street2 || null,
      city: addr?.city ? String(addr.city) : null,
      state: addr?.state ? String(addr.state) : null,
      postal_code: addr?.postal_code ?? addr?.postcode ?? addr?.zip ? String(addr?.postal_code ?? addr?.postcode ?? addr?.zip) : null,
      country: addr?.country ?? d?.country ? String(addr?.country ?? d?.country) : null
    };
    if (Object.values(normalizedAddress).some((v)=>v !== null && String(v).trim().length > 0)) {
      update.bridge_address_object = normalizedAddress;
    }
    if (street) update.address = street2 ? `${street}, ${street2}` : String(street);
    if (addr?.city) update.city = String(addr.city);
    const postal = addr?.postal_code ?? addr?.postcode ?? addr?.zip;
    if (postal) update.postal_code = String(postal);
    const country = addr?.country ?? d?.country;
    if (country) update.country = String(country);
    await supabase.from("user_profiles").update(update).eq("bridge_customer_id", String(customer));
    if (accountStatus === "paused" && previousAccountStatus !== "paused") {
      try {
        const owner = await resolveOwnerFromBridgeCustomer(String(customer));
        await emailAccountPausedBestEffort(owner.resolved, owner.account_type, String(customer), pausedAt);
      } catch  {}
    }
    try {
      const owner = await resolveOwnerFromBridgeCustomer(String(customer));
      await syncCountryFromBridgeCustomer(String(customer), owner);
    } catch  {
    // Keep customer status processing resilient; owner mapping is handled by queue retries.
    }
    // Terminal customer KYC decision → best-effort email. Individual only;
    // business KYB decisions are emailed from handleBridgeKycKyb. active→approved,
    // rejected→rejected (uses the v13 terminal mapping above).
    if (canonicalKyc === "verified" || canonicalKyc === "rejected") {
      try {
        const owner = await resolveOwnerFromBridgeCustomer(String(customer));
        if (owner.account_type === "individual") {
          await emailKycDecisionBestEffort(owner.resolved, false, canonicalKyc === "verified" ? "approved" : "rejected");
        }
      } catch  {}
    }
    if (canonicalKyc === "verified") {
      const owner = await resolveOwnerFromBridgeCustomer(String(customer));
      await ensureStablecoinWalletsProvisioned({
        userId: owner.resolved,
        bridgeCustomerId: String(customer),
        accountType: owner.account_type
      });
      await supabase.rpc("apply_card_waitlist_referral_approval", {
        p_event_id: ev.event_id,
        p_referred_id: owner.resolved,
        p_spots: 500,
        p_metadata: {
          source: "bridge",
          kind: "customer",
          bridge_customer_id: String(customer),
          bridge_status: accountStatus
        }
      });
    }
  }
  await supabase.from("bridge_webhook_events").update({
    target_entity_type: "customer",
    target_entity_id: String(customer)
  }).eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "customer",
      status: accountStatus
    }
  });
}
// Currency scale map. Minor-unit math is integer-only; no float drift.
// Stablecoins are intentionally absent — wallet credit lives in a separate
// chunk (drift #3 covers VA fiat; stablecoin balance is future work).
const CURRENCY_SCALE = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
  USDB: 6,
  EURC: 6
};
const FIAT_VA_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP"
]);
const BRIDGE_SETTLEMENT_ASSET_CURRENCIES = new Set([
  "USDC",
  "USDT",
  "PYUSD",
  "USDB",
  "EURC"
]);
const DEFAULT_VA_DEVELOPER_FEE_PERCENT_BY_ACCOUNT = {
  individual: 2.5,
  business: 2.0
};
const BRIDGE_COUNTRY_CODE_RE = /^[A-Z]{2}$/;
function normalizeCountryCode(value) {
  const s = String(value ?? "").trim().toUpperCase();
  return BRIDGE_COUNTRY_CODE_RE.test(s) ? s : null;
}
/**
 * Convert a Bridge amount (number or decimal string) into bigint minor units.
 * Returns null for unsupported currency or malformed input. Pure integer math.
 */ function toMinorUnits(amount, currency) {
  const scale = CURRENCY_SCALE[currency.toUpperCase()];
  if (scale === undefined) return null;
  const raw = typeof amount === "string" ? amount.trim() : typeof amount === "number" ? Number.isFinite(amount) ? amount.toString() : "" : "";
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const abs = negative ? raw.slice(1) : raw;
  const [intPart, fracPart = ""] = abs.split(".");
  const padded = (fracPart + "0".repeat(scale)).slice(0, scale);
  const minor = BigInt(intPart) * 10n ** BigInt(scale) + BigInt(padded || "0");
  return negative ? -minor : minor;
}
function formatMinorUnits(amountMinor, currency) {
  const scale = CURRENCY_SCALE[currency.toUpperCase()] ?? 2;
  const negative = amountMinor < 0n;
  const abs = negative ? -amountMinor : amountMinor;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = abs % base;
  const numeric = Number(`${negative ? "-" : ""}${whole}.${frac.toString().padStart(scale, "0")}`);
  return `${numeric.toLocaleString(undefined, {
    maximumFractionDigits: Math.min(scale, 6)
  })} ${currency.toUpperCase()}`;
}
function minorToDecimal(amountMinor, currency) {
  return Number(amountMinor) / 10 ** (CURRENCY_SCALE[currency.toUpperCase()] ?? 2);
}
function absMinor(amountMinor) {
  return amountMinor < 0n ? -amountMinor : amountMinor;
}
function normalizeBridgeEndpointType(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "bridge_wallet" || raw === "wallet") return "wallet";
  if (raw === "virtual_account" || raw === "virtual_account_bank" || raw === "payment_route") return "virtual_account";
  if (raw === "external_wallet" || raw === "crypto" || raw === "blockchain") return "external_wallet";
  if (raw === "external_bank" || raw === "ach" || raw === "wire" || raw === "sepa" || raw === "faster_payments") return "external_bank";
  return "external_bank";
}
function bridgeTransferDirection(sourceType, destinationType) {
  if (sourceType === "wallet") return "debit";
  if (destinationType === "wallet") return "credit";
  if (sourceType === "virtual_account" || sourceType === "external_bank") return "credit";
  return "debit";
}
function inferWalletActivityDirection(eventType, payload, amountMinor) {
  if (amountMinor !== null && amountMinor < 0n) return "debit";
  const sourceRail = normalizeBridgeEndpointType(payload?.source?.payment_rail ?? payload?.source?.type ?? payload?.source_payment_rail ?? payload?.source_type);
  const destinationRail = normalizeBridgeEndpointType(payload?.destination?.payment_rail ?? payload?.destination?.type ?? payload?.destination_payment_rail ?? payload?.destination_type);
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
    payload?.memo
  ].map((v)=>String(v ?? "").toLowerCase()).join(" ");
  if (/\b(debit|withdraw|withdrawal|sent|send|payout|transfer_out|outbound)\b/.test(markers)) return "debit";
  if (/\b(credit|deposit|received|receive|collection|transfer_in|inbound)\b/.test(markers)) return "credit";
  // Money movement must fail closed. Bridge wallet activity observed in
  // production identifies withdrawals/deposits through the endpoint rails or
  // activity type. Treating an unrecognised positive amount as a credit can
  // increase a user's spendable balance after an outbound payout.
  return null;
}
function bridgeTransferIdFromPayload(payload) {
  const candidates = [
    payload?.bridge_transfer_id,
    payload?.transfer_id,
    payload?.transfer?.id,
    payload?.source?.transfer_id,
    payload?.destination?.transfer_id,
    payload?.metadata?.bridge_transfer_id,
    payload?.metadata?.transfer_id
  ];
  for (const candidate of candidates){
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return null;
}
function firstMinorUnitAmount(payload, currency, keys) {
  for (const key of keys){
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
function firstNonEmptyText(...values) {
  for (const value of values){
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}
function firstFiniteNumber(...values) {
  for (const value of values){
    if (value && typeof value === "object") {
      const nested = firstFiniteNumber(value.amount);
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
function maskAddress(value) {
  const text = String(value || "").trim();
  if (text.length <= 12) return text || null;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
function bridgeReceiptId(payload, vaId) {
  const rawId = firstNonEmptyText(payload?.id);
  return firstNonEmptyText(payload?.deposit_id, payload?.receipt?.deposit_id, payload?.receipt?.id, payload?.deposit?.id, rawId && rawId !== String(vaId) ? rawId : null, payload?.reference, payload?.source?.tracking_number);
}
function normalizeCurrencyCode(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return CURRENCY_SCALE[text] !== undefined ? text : null;
}
function bridgeVirtualAccountSourceCurrency(payload, existingAccountDetails, existingCurrency) {
  const details = objectValue(existingAccountDetails) ?? {};
  const payloadDetails = objectValue(payload?.account_details) ?? {};
  return normalizeCurrencyCode(payload?.source_deposit_instructions?.currency) ?? normalizeCurrencyCode(objectValue(payloadDetails.source_deposit_instructions)?.currency) ?? normalizeCurrencyCode(objectValue(details.source_deposit_instructions)?.currency) ?? normalizeCurrencyCode(existingCurrency) ?? normalizeCurrencyCode(payload?.currency) ?? "USD";
}
function isConvertedVirtualAccountSettlementEvent(activityType, sourceCurrency, eventCurrency) {
  return FIAT_VA_CURRENCIES.has(sourceCurrency) && BRIDGE_SETTLEMENT_ASSET_CURRENCIES.has(eventCurrency) && [
    "payment_submitted",
    "payment_processed",
    "processed",
    "succeeded",
    "success"
  ].includes(activityType);
}
function isFiatVirtualAccountCreditEvent(activityType, sourceCurrency, eventCurrency) {
  return FIAT_VA_CURRENCIES.has(sourceCurrency) && eventCurrency === sourceCurrency && [
    "funds_received",
    "payment_received",
    "credit_received"
  ].includes(activityType);
}
function receivedAmountBreakdown(payload, currency) {
  return bridgeReceiptBreakdown(payload, currency);
}
function hasExplicitBridgeDeveloperFee(payload) {
  const receipt = objectValue(payload?.receipt) ?? {};
  const candidates = [
    receipt.developer_fee_amount,
    receipt.developer_fee,
    receipt.service_charge_amount,
    payload?.developer_fee_amount,
    payload?.developerFeeAmount,
    payload?.developer_fee,
    payload?.developerFee
  ];
  return candidates.some((value)=>value !== null && value !== undefined && String(value && typeof value === "object" ? value.amount ?? "" : value).trim() !== "");
}
async function recordBridgeWebhookRevenue(params) {
  const sourceId = String(params.sourceId || "").trim();
  if (!sourceId) throw new Error("bridge webhook revenue source id is required");
  if ((params.eventKind ?? "earned") === "earned" && params.grossCustomerFee === null) {
    throw new Error("bridge webhook developer fee evidence is malformed");
  }
  const occurredAtRaw = String(params.occurredAt ?? "").trim();
  const occurredAt = occurredAtRaw && Number.isFinite(Date.parse(occurredAtRaw)) ? occurredAtRaw : new Date().toISOString();
  const { error } = await supabase.rpc("record_provider_revenue_event", {
    p_provider: "bridge",
    p_environment: "live",
    p_source_type: params.sourceType,
    p_source_id: sourceId,
    p_source_event_id: params.event.event_id,
    p_event_kind: params.eventKind ?? "earned",
    p_revenue_category: "developer_fee",
    p_fee_currency: params.feeCurrency,
    p_gross_customer_fee: params.grossCustomerFee,
    p_provider_cost: params.grossCustomerFee === null ? null : 0,
    p_source_amount: params.sourceAmount,
    p_source_currency: params.sourceCurrency,
    p_destination_currency: params.destinationCurrency,
    p_usd_rate: [
      "USD",
      "USDC",
      "USDT"
    ].includes(String(params.feeCurrency || "").toUpperCase()) ? 1 : null,
    p_reconciliation_status: "reconciled",
    p_evidence: {
      source: "bridge_webhook_events",
      signature_verified_at_ingress: true,
      queue_event_id: params.event.event_id,
      event_type: params.event.event_type,
      event_object: params.rawObject
    },
    p_occurred_at: occurredAt
  });
  if (error) throw new Error(`record_provider_revenue_event failed: ${error.message}`);
}
async function reverseBridgeWebhookRevenue(params) {
  const sourceId = String(params.sourceId || "").trim();
  if (!sourceId) return;
  // Refunds reverse only a prior earned fee for the same provider resource.
  // Do not manufacture zero-value reversals when no revenue was recognized.
  const { data: earned, error: earnedError } = await supabase.from("provider_revenue_events").select("source_id").eq("provider", "bridge").eq("environment", "live").eq("source_type", params.sourceType).eq("source_id", sourceId).eq("event_kind", "earned").eq("revenue_category", "developer_fee").maybeSingle();
  if (earnedError) throw new Error(`provider revenue earning lookup failed: ${earnedError.message}`);
  if (!earned) return;
  await recordBridgeWebhookRevenue({
    event: params.event,
    sourceType: params.sourceType,
    sourceId,
    eventKind: "reversal",
    feeCurrency: null,
    grossCustomerFee: null,
    sourceAmount: null,
    sourceCurrency: null,
    destinationCurrency: null,
    occurredAt: params.occurredAt,
    rawObject: params.rawObject
  });
}
function bridgeVaReceiptDetails(params) {
  const p = params.payload || {};
  const receipt = objectValue(p.receipt) ?? {};
  const destination = objectValue(p.destination) ?? objectValue(receipt.destination) ?? objectValue(params.accountDetails.destination) ?? objectValue(objectValue(p.account_details)?.destination) ?? {};
  const sourceInstructions = objectValue(p.source_deposit_instructions) ?? objectValue(params.accountDetails.source_deposit_instructions) ?? objectValue(objectValue(p.account_details)?.source_deposit_instructions) ?? {};
  const source = objectValue(p.source) ?? objectValue(receipt.source) ?? {};
  const tracking = objectValue(p.tracking) ?? objectValue(receipt.tracking) ?? {};
  const sourceCurrency = params.sourceCurrency.toUpperCase();
  const eventCurrency = params.eventCurrency.toUpperCase();
  const isConvertedSettlement = sourceCurrency !== eventCurrency && BRIDGE_SETTLEMENT_ASSET_CURRENCIES.has(eventCurrency);
  const destinationCurrency = firstNonEmptyText(receipt.destination_currency, receipt.outgoing_currency, p.destination_currency, p.to_currency, destination.currency, destination.asset, isConvertedSettlement ? eventCurrency : null)?.toUpperCase() ?? null;
  const destinationAmount = firstFiniteNumber(receipt.destination_amount, receipt.outgoing_amount, receipt.final_destination_amount, p.destination_amount, p.outgoing_amount, p.final_destination_amount, p.net_destination_amount, destination.amount, isConvertedSettlement ? receipt.final_amount : null, isConvertedSettlement ? p.amount : null);
  const destinationAddress = firstNonEmptyText(receipt.destination_address, p.destination_address, destination.address, destination.to_address);
  const exchangeRate = firstFiniteNumber(receipt.exchange_rate, receipt.rate, p.exchange_rate, p.conversion_rate, p.rate);
  const breakdown = params.breakdown;
  const sourceAmount = firstFiniteNumber(receipt.initial_amount, p.initial_amount, isConvertedSettlement ? null : p.amount) ?? (breakdown ? minorToDecimal(breakdown.grossMinor, sourceCurrency) : null);
  const serviceChargeAmount = firstFiniteNumber(receipt.developer_fee_amount, receipt.developer_fee, p.developer_fee_amount, p.developer_fee) ?? (breakdown ? minorToDecimal(breakdown.developerFeeMinor, sourceCurrency) : null);
  const availableAmount = firstFiniteNumber(receipt.subtotal_amount, p.subtotal_amount, isConvertedSettlement ? null : receipt.final_amount, isConvertedSettlement ? null : p.final_amount, isConvertedSettlement ? null : p.net_amount) ?? (breakdown ? minorToDecimal(breakdown.netMinor, sourceCurrency) : null);
  return {
    deposit_id: bridgeReceiptId(p, params.vaId),
    source_currency: sourceCurrency,
    source_amount: sourceAmount,
    service_charge_amount: serviceChargeAmount,
    available_amount: availableAmount,
    destination_currency: destinationCurrency,
    destination_amount: destinationAmount,
    exchange_rate: exchangeRate,
    destination_address: maskAddress(destinationAddress),
    destination_rail: firstNonEmptyText(receipt.destination_rail, receipt.destination_payment_rail, p.destination_rail, p.destination_payment_rail, destination.payment_rail, destination.rail),
    source_rail: firstNonEmptyText(receipt.source_rail, p.source_rail, sourceInstructions.payment_rail, sourceInstructions.rail),
    // Bridge receipt enhancements are optional. Preserve only values actually
    // supplied by the signed provider event; never synthesize trace evidence.
    source_bank_name: firstNonEmptyText(receipt.source_bank_name, p.source_bank_name, source.bank_name, source.bank),
    source_bank_account: firstNonEmptyText(receipt.source_bank_account, p.source_bank_account, source.account_number, source.account_last_4),
    payment_reference_text: firstNonEmptyText(receipt.reference_text, receipt.payment_reference, p.reference_text, p.payment_reference, p.memo),
    receiving_bank_name: firstNonEmptyText(receipt.receiving_bank_name, p.receiving_bank_name, sourceInstructions.bank_name),
    receiving_account_name: firstNonEmptyText(receipt.receiving_account_name, p.receiving_account_name, sourceInstructions.account_name, sourceInstructions.beneficiary_name),
    receiving_account_number: firstNonEmptyText(receipt.receiving_account_number, p.receiving_account_number, sourceInstructions.account_number, sourceInstructions.iban),
    trace_id: firstNonEmptyText(receipt.trace_id, receipt.ach_trace_number, p.trace_id, p.ach_trace_number, tracking.trace_id),
    imad: firstNonEmptyText(receipt.imad, p.imad, tracking.imad),
    uetr: firstNonEmptyText(receipt.uetr, p.uetr, tracking.uetr),
    clave_de_rastreo: firstNonEmptyText(receipt.clave_de_rastreo, p.clave_de_rastreo, tracking.clave_de_rastreo)
  };
}
function humanizeRail(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.split(/[_\s-]+/).filter(Boolean).map((part)=>part.length <= 4 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}
function bridgeVaRefundDetails(payload) {
  const p = payload || {};
  const refund = objectValue(p.refund) ?? {};
  const source = objectValue(p.source) ?? {};
  return {
    return_reason: firstNonEmptyText(refund.reason, p.return_reason, p.reason),
    returned_at: firstNonEmptyText(refund.refunded_at, refund.returned_at, p.returned_at, p.created_at),
    risk_rejection_reason: firstNonEmptyText(refund.risk_rejection_reason, p.risk_rejection_reason),
    refund_rail: humanizeRail(firstNonEmptyText(refund.rail, refund.refund_rail, source.payment_rail, source.payment_scheme)),
    refund_beneficiary_name: firstNonEmptyText(refund.beneficiary_name, refund.refund_beneficiary_name, source.sender_name, source.originator_name),
    refund_reference_id: firstNonEmptyText(refund.refund_reference_id, refund.reference_id, refund.tracking_number, p.refund_reference_id)
  };
}
function transferReceiptBreakdown(payload, currency) {
  return bridgeReceiptBreakdown(payload, currency);
}
function normalizeTransactionEmailStatus(raw) {
  const s = raw.trim().toLowerCase();
  if ([
    "in_review",
    "under_review",
    "review",
    "pending_review",
    "manual_review"
  ].includes(s)) return "in_review";
  if ([
    "approved",
    "completed",
    "complete",
    "payment_processed",
    "processed",
    "succeeded",
    "success"
  ].includes(s)) return "approved";
  if ([
    "canceled",
    "cancelled",
    "cancelled_by_customer",
    "canceled_by_customer"
  ].includes(s)) return "canceled";
  if ([
    "refund_in_flight",
    "refund_pending",
    "return_in_flight"
  ].includes(s)) return "refund_in_flight";
  if ([
    "refunded",
    "returned",
    "refund_complete",
    "refund_completed"
  ].includes(s)) return "refunded";
  return null;
}
function transactionStatusTitle(status) {
  switch(status){
    case "in_review":
      return "Transaction under review";
    case "approved":
      return "Transaction approved";
    case "canceled":
      return "Transaction canceled";
    case "refund_in_flight":
      return "Refund in progress";
    case "refunded":
      return "Transaction refunded";
  }
}
function decimalAmountLabel(value, currency) {
  const c = String(currency ?? "").toUpperCase();
  const n = Number(value);
  if (!c || !Number.isFinite(n)) return null;
  const minor = toMinorUnits(String(n), c);
  return minor === null ? `${n} ${c}` : formatMinorUnits(minor, c);
}
function transactionStatusBody(status, amountLabel, metadata) {
  const currency = metadata?.currency;
  const grossLabel = decimalAmountLabel(metadata?.gross_amount, currency);
  const transactionFeeLabel = decimalAmountLabel(metadata?.developer_fee_amount, currency);
  const exchangeFeeLabel = decimalAmountLabel(metadata?.exchange_fee_amount, currency);
  const hasFeeBreakdown = Boolean(grossLabel && (Number(metadata?.developer_fee_amount ?? 0) > 0 || Number(metadata?.exchange_fee_amount ?? 0) > 0));
  const receiptPrefix = hasFeeBreakdown ? `Full amount received: ${grossLabel}. ${transactionFeeLabel ? `Transaction fee: -${transactionFeeLabel}. ` : ""}${exchangeFeeLabel ? `Exchange fee: -${exchangeFeeLabel}. ` : ""}Net amount: ${amountLabel}. ` : "";
  switch(status){
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
async function insertTransactionStatusNotification(params) {
  const { data: existingNotification } = await supabase.from("notifications").select("id").eq("user_id", params.userId).eq("type", "transaction").contains("metadata", params.idempotencyMatch).maybeSingle();
  if (existingNotification?.id) return false;
  await supabase.from("notifications").insert({
    user_id: params.userId,
    type: "transaction",
    title: transactionStatusTitle(params.status),
    body: transactionStatusBody(params.status, params.amountLabel, params.metadata),
    metadata: params.metadata
  });
  return true;
}
function publicTransactionStatus(status) {
  if (status === "approved") return "completed";
  if (status === "in_review" || status === "refund_in_flight") return "pending";
  return "failed";
}
function transactionStatusDescription(status) {
  switch(status){
    case "in_review":
      return "Deposit under compliance review";
    case "approved":
      return "Deposit approved";
    case "canceled":
      return "Deposit canceled";
    case "refund_in_flight":
      return "Deposit refund in progress";
    case "refunded":
      return "Deposit refunded";
  }
}
async function upsertVirtualAccountStatusTransaction(params) {
  const { error } = await supabase.from("transactions").upsert({
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
      transaction_type: "virtual_account_deposit"
    },
    provider: "bridge",
    created_at: params.occurredAt ?? new Date().toISOString()
  }, {
    onConflict: "reference"
  });
  if (error) throw new Error(`upsert VA status transaction failed: ${error.message}`);
}
function normalizeDeveloperFeePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}
function normalizeBridgeVirtualAccountRail(value) {
  const rail = String(value ?? "").trim().toLowerCase();
  if (!rail) return null;
  if (rail === "ach") return "ach_push";
  if ([
    "ach_push",
    "ach_pull",
    "wire",
    "sepa",
    "faster_payments"
  ].includes(rail)) return rail;
  return null;
}
function normalizeBridgeVirtualAccountStatus(value, eventType) {
  const status = String(value ?? "").trim().toLowerCase();
  if ([
    "deactivated",
    "inactive"
  ].includes(status)) return "deactivated";
  if ([
    "closed",
    "deleted",
    "disabled"
  ].includes(status)) return "closed";
  if ([
    "suspended",
    "paused"
  ].includes(status)) return "suspended";
  if ([
    "active",
    "enabled",
    "open",
    "ready",
    "provisioned"
  ].includes(status)) return "active";
  const event = String(eventType ?? "").trim().toLowerCase();
  if (event.includes("deactivat") || event.includes("inactive")) return "deactivated";
  if (event.includes("closed") || event.includes("deleted") || event.includes("disabled")) return "closed";
  if (event.includes("suspend") || event.includes("paused")) return "suspended";
  return "active";
}
function normalizedText(value) {
  return String(value ?? "").trim();
}
function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
async function resolvesToSavedExternalWallet(params) {
  const destination = objectValue(params.accountDetails.destination) ?? objectValue(params.payload.destination) ?? objectValue(objectValue(params.payload.account_details)?.destination);
  if (!destination) return false;
  const markedSource = normalizedText(destination.source).toLowerCase();
  if (markedSource === "external_wallet") return true;
  if (normalizedText(destination.external_wallet_id)) return true;
  const address = normalizedText(destination.address).toLowerCase();
  const asset = normalizedText(destination.currency).toUpperCase();
  const chain = normalizedText(destination.payment_rail || destination.chain).toLowerCase();
  if (!address || !asset || !chain) return false;
  const { data } = await supabase.from("external_wallets").select("id,address").eq("user_id", params.userId).ilike("asset", asset).ilike("chain", chain).eq("status", "active").limit(20);
  return (data || []).some((row)=>normalizedText(row?.address).toLowerCase() === address);
}
const cachedCanonicalVaDeveloperFeePercentByAccount = {};
async function getCanonicalVaDeveloperFeePercent(accountType) {
  if (cachedCanonicalVaDeveloperFeePercentByAccount[accountType] !== undefined) {
    return cachedCanonicalVaDeveloperFeePercentByAccount[accountType];
  }
  const settingKey = accountType === "business" ? "bridge.virtual_account.business.developer_fee_percent" : "bridge.virtual_account.individual.developer_fee_percent";
  const { data: typedSetting } = await supabase.from("provider_settings").select("value").eq("key", settingKey).maybeSingle();
  const { data: setting } = await supabase.from("provider_settings").select("value").eq("key", "bridge.virtual_account.developer_fee_percent").maybeSingle();
  const fee = normalizeDeveloperFeePercent(typedSetting?.value) ?? normalizeDeveloperFeePercent(setting?.value) ?? DEFAULT_VA_DEVELOPER_FEE_PERCENT_BY_ACCOUNT[accountType];
  cachedCanonicalVaDeveloperFeePercentByAccount[accountType] = fee;
  return fee;
}
async function upsertBridgeVirtualAccountProjection(params) {
  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(params.customer);
  const canonicalFee = await getCanonicalVaDeveloperFeePercent(account_type);
  const payloadFee = normalizeDeveloperFeePercent(params.payload?.developer_fee_percent) ?? normalizeDeveloperFeePercent(params.payload?.virtual_account?.developer_fee_percent);
  const effectiveFee = payloadFee ?? normalizeDeveloperFeePercent(params.existingFeePercent) ?? canonicalFee;
  const status = normalizeBridgeVirtualAccountStatus(params.payload?.status, params.eventType);
  const reactivatedBySupport = String(params.existingStatus || "").toLowerCase() === "deactivated" && status === "active";
  const newlyDeactivated = ![
    "deactivated",
    "closed"
  ].includes(String(params.existingStatus || "").toLowerCase()) && [
    "deactivated",
    "closed"
  ].includes(status);
  const existingDetails = params.existingAccountDetails && typeof params.existingAccountDetails === "object" ? params.existingAccountDetails : {};
  const payloadDetails = params.payload && typeof params.payload === "object" ? params.payload : {};
  const destinationDetails = existingDetails.destination && typeof existingDetails.destination === "object" ? existingDetails.destination : payloadDetails.destination && typeof payloadDetails.destination === "object" ? payloadDetails.destination : null;
  const destinationSource = destinationDetails && typeof destinationDetails === "object" ? String(destinationDetails.source || "").trim().toLowerCase() : "";
  const mergedAccountDetails = {
    ...existingDetails,
    ...payloadDetails,
    ...destinationDetails ? {
      destination: destinationDetails
    } : {},
    source_deposit_instructions: params.payload?.source_deposit_instructions ?? params.payload?.account_details?.source_deposit_instructions ?? existingDetails.source_deposit_instructions ?? null
  };
  await supabase.from("bridge_virtual_accounts").upsert({
    bridge_virtual_account_id: String(params.vaId),
    bridge_customer_id: String(params.customer),
    user_id: account_type === "individual" ? resolved : null,
    business_user_id: account_type === "business" ? resolved : null,
    currency: params.currency,
    rail: normalizeBridgeVirtualAccountRail(params.payload?.source_deposit_instructions?.payment_rail ?? params.payload?.rail ?? params.payload?.payment_rail),
    account_details: mergedAccountDetails,
    status,
    ...reactivatedBySupport ? {
      activated_at: new Date().toISOString(),
      deactivated_at: null,
      deactivation_reason: null
    } : newlyDeactivated ? {
      deactivated_at: new Date().toISOString(),
      deactivation_reason: "bridge_webhook"
    } : typeof params.existingActivatedAt === "string" ? {
      activated_at: params.existingActivatedAt
    } : typeof params.payload?.created_at === "string" && !Number.isNaN(Date.parse(params.payload.created_at)) ? {
      activated_at: params.payload.created_at
    } : {},
    developer_fee_percent: effectiveFee,
    updated_at: new Date().toISOString()
  }, {
    onConflict: "bridge_virtual_account_id"
  });
  if (status === "active") {
    await supabase.from("pending_va_requests").update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolution_note: `Resolved by Bridge virtual account ${params.vaId}.`
    }).eq(account_type === "business" ? "bridge_customer_id" : "user_id", account_type === "business" ? String(params.customer) : resolved).eq("currency", params.currency).eq("status", "pending");
  }
  const inferredExternalDestination = await resolvesToSavedExternalWallet({
    userId: resolved,
    accountDetails: mergedAccountDetails,
    payload: payloadDetails
  });
  return {
    resolved,
    account_type,
    developer_fee_percent: effectiveFee,
    status,
    destination_source: inferredExternalDestination ? "external_wallet" : destinationSource
  };
}
async function handleBridgeVirtualAccount(ev) {
  // Bridge envelope: event_object is the virtual_account; event_object_id its id.
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const vaId = d?.virtual_account_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!vaId) throw new Error("bridge virtual_account event missing virtual_account_id");
  const payloadCustomer = d?.customer_id ?? d?.customer?.id;
  const { data: existingVa } = await supabase.from("bridge_virtual_accounts").select("bridge_customer_id,developer_fee_percent,account_details,currency,status,activated_at").eq("bridge_virtual_account_id", String(vaId)).maybeSingle();
  const customer = payloadCustomer ?? existingVa?.bridge_customer_id;
  if (!customer) throw new Error("bridge virtual_account event missing customer_id and VA mapping");
  const t = ev.event_type.toLowerCase();
  const isActivity = t.includes("activity") || t.includes("deposit") || t.includes("credit") || t.includes("debit") || t.includes("withdraw") || t.includes("transfer");
  const currency = bridgeVirtualAccountSourceCurrency(d, existingVa?.account_details, existingVa?.currency);
  const eventCurrency = normalizeCurrencyCode(d?.currency) ?? currency;
  const owner = await upsertBridgeVirtualAccountProjection({
    vaId: String(vaId),
    customer: String(customer),
    payload: d,
    currency,
    existingFeePercent: existingVa?.developer_fee_percent,
    existingAccountDetails: existingVa?.account_details,
    existingStatus: existingVa?.status,
    existingActivatedAt: existingVa?.activated_at,
    eventType: ev.payload?.type ?? ev.payload?.event_type ?? ev.event_type
  });
  const deliversToExternalWallet = owner.destination_source === "external_wallet";
  const accountDetails = objectValue(existingVa?.account_details) ?? {};
  // Lifecycle event (created/updated/etc): projection already upserted above.
  if (!isActivity) {
    const { resolved, account_type } = owner;
    if (owner.status !== "active") {
      await supabase.from("bridge_webhook_events").update({
        target_entity_type: "virtual_account",
        target_entity_id: String(vaId)
      }).eq("event_id", ev.event_id);
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary: {
          source: "bridge",
          kind: "virtual_account",
          virtual_account_id: vaId,
          status: owner.status,
          notified: false
        }
      });
      return;
    }
    const notificationMatch = {
      kind: "global_account_ready",
      virtual_account_id: String(vaId),
      currency
    };
    const { data: existingNotification } = await supabase.from("notifications").select("id").eq("user_id", resolved).eq("type", "account").contains("metadata", notificationMatch).maybeSingle();
    if (!existingNotification?.id) {
      await supabase.from("notifications").insert({
        user_id: resolved,
        type: "account",
        title: `${currency} global account active`,
        body: `Your ${currency} global account is active and ready to receive payments.`,
        metadata: {
          ...notificationMatch,
          source: "bridge",
          bridge_event_id: ev.event_id
        }
      });
    }
    await emailGlobalAccountReadyBestEffort({
      userId: resolved,
      accountType: account_type,
      currency,
      virtualAccountId: String(vaId)
    });
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "virtual_account",
      target_entity_id: String(vaId)
    }).eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        notified: true
      }
    });
    return;
  }
  // Activity / deposit / credit event.
  const activityType = String(d?.status ?? d?.type ?? "").trim().toLowerCase();
  const nonCreditStatus = normalizeTransactionEmailStatus(activityType);
  if (nonCreditStatus && nonCreditStatus !== "approved") {
    const isUnderReview = nonCreditStatus === "in_review";
    const depositId = String(d?.deposit_id ?? "").trim();
    const statusBreakdown = receivedAmountBreakdown(d, currency);
    const statusReceipt = bridgeVaReceiptDetails({
      payload: d,
      sourceCurrency: currency,
      eventCurrency,
      vaId,
      accountDetails,
      breakdown: statusBreakdown
    });
    const refundDetails = bridgeVaRefundDetails(d);
    const receiptDepositId = String(statusReceipt.deposit_id || depositId || "").trim();
    if (nonCreditStatus === "refunded" || nonCreditStatus === "canceled") {
      await reverseBridgeWebhookRevenue({
        event: ev,
        sourceType: "bridge_virtual_account",
        sourceId: receiptDepositId || depositId,
        occurredAt: d?.updated_at ?? d?.created_at ?? ev.payload?.event_created_at,
        rawObject: d
      });
    }
    // `in_review` is not fee recognition. Bridge may announce the configured
    // developer fee on this event, but the incoming payment is still under
    // compliance review and no fee/net breakdown should be presented yet.
    // Fee presentation begins only on the later payment_submitted lifecycle.
    const statusAmountMinor = isUnderReview ? statusBreakdown?.grossMinor ?? toMinorUnits(d?.amount, currency) : statusBreakdown?.netMinor ?? toMinorUnits(d?.amount, currency);
    const amountLabel = statusAmountMinor == null ? `${String(d?.amount ?? "").trim() || "Your"} ${currency}`.trim() : formatMinorUnits(statusAmountMinor, currency);
    let reversal = null;
    if (!deliversToExternalWallet && (nonCreditStatus === "refunded" || nonCreditStatus === "canceled") && statusAmountMinor !== null && statusAmountMinor > 0n) {
      const reversalEventId = depositId ? `bridge:va:${String(vaId)}:deposit:${depositId}:reversal` : `bridge:va:${String(vaId)}:event:${ev.event_id}:reversal`;
      const { data: reversalResult, error: reversalErr } = await supabase.rpc("apply_bridge_va_debit", {
        p_event_id: reversalEventId,
        p_bridge_va_id: String(vaId),
        p_user_id: owner.account_type === "individual" ? owner.resolved : null,
        p_business_user_id: owner.account_type === "business" ? owner.resolved : null,
        p_currency: currency,
        p_amount_minor: statusAmountMinor.toString(),
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
          raw: d
        }
      });
      if (reversalErr) {
        throw new Error(`apply_bridge_va_debit failed: ${reversalErr.message}`);
      }
      const reversalRow = Array.isArray(reversalResult) ? reversalResult[0] : reversalResult;
      reversal = {
        applied: reversalRow?.applied ?? false,
        debited_amount_minor: reversalRow?.debited_amount_minor ?? null,
        new_balance_minor: reversalRow?.new_balance_minor ?? null
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
      developer_fee_amount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.developerFeeMinor, currency) : null,
      exchange_fee_amount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.exchangeFeeMinor, currency) : null,
      net_amount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.netMinor, currency) : null,
      currency,
      direction: "credit",
      ...deliversToExternalWallet ? {
        delivery: "external_wallet",
        balance_impact: "none"
      } : {},
      receipt: statusReceipt,
      refund_details: refundDetails,
      reversal
    };
    const { resolved, account_type } = owner;
    const statusReference = receiptDepositId ? `bridge:va:${String(vaId)}:deposit:${receiptDepositId}` : `bridge:va:${String(vaId)}:event:${ev.event_id}`;
    if (statusAmountMinor !== null) {
      await upsertVirtualAccountStatusTransaction({
        userId: resolved,
        accountType: account_type,
        status: nonCreditStatus,
        amount: minorToDecimal(statusAmountMinor, currency),
        currency,
        reference: statusReference,
        description: transactionStatusDescription(nonCreditStatus),
        metadata: statusMetadata,
        occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null
      });
    }
    const notified = await insertTransactionStatusNotification({
      userId: resolved,
      status: nonCreditStatus,
      amountLabel,
      metadata: statusMetadata,
      idempotencyMatch: receiptDepositId || depositId ? {
        deposit_id: receiptDepositId || depositId,
        kind: "virtual_account_deposit_status",
        status: nonCreditStatus
      } : {
        bridge_event_id: ev.event_id,
        kind: "virtual_account_deposit_status",
        status: nonCreditStatus
      }
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
        grossAmount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.grossMinor, currency) : null,
        developerFeeAmount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.developerFeeMinor, currency) : null,
        exchangeFeeAmount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.exchangeFeeMinor, currency) : null,
        netAmount: !isUnderReview && statusBreakdown ? minorToDecimal(statusBreakdown.netMinor, currency) : null,
        sourceCurrency: String(statusReceipt.source_currency || currency),
        sourceAmount: isUnderReview ? null : Number(statusReceipt.source_amount ?? NaN),
        serviceChargeAmount: isUnderReview ? null : Number(statusReceipt.service_charge_amount ?? NaN),
        availableAmount: isUnderReview ? null : Number(statusReceipt.available_amount ?? NaN),
        destinationCurrency: isUnderReview ? null : String(statusReceipt.destination_currency || ""),
        destinationAmount: isUnderReview ? null : Number(statusReceipt.destination_amount ?? NaN),
        exchangeRate: isUnderReview ? null : Number(statusReceipt.exchange_rate ?? NaN),
        destinationAddress: String(statusReceipt.destination_address || ""),
        destinationRail: String(statusReceipt.destination_rail || ""),
        sourceRail: String(statusReceipt.source_rail || ""),
        depositId: receiptDepositId || null,
        refundReturnReason: String(refundDetails.return_reason || ""),
        refundReturnedAt: String(refundDetails.returned_at || ""),
        refundRiskRejectionReason: String(refundDetails.risk_rejection_reason || ""),
        refundRail: String(refundDetails.refund_rail || ""),
        refundBeneficiaryName: String(refundDetails.refund_beneficiary_name || ""),
        refundReferenceId: String(refundDetails.refund_reference_id || ""),
        sourceBankName: String(statusReceipt.source_bank_name || ""),
        sourceBankAccount: String(statusReceipt.source_bank_account || ""),
        paymentReferenceText: String(statusReceipt.payment_reference_text || ""),
        receivingBankName: String(statusReceipt.receiving_bank_name || ""),
        receivingAccountName: String(statusReceipt.receiving_account_name || ""),
        receivingAccountNumber: String(statusReceipt.receiving_account_number || ""),
        traceId: String(statusReceipt.trace_id || ""),
        imad: String(statusReceipt.imad || ""),
        uetr: String(statusReceipt.uetr || ""),
        claveDeRastreo: String(statusReceipt.clave_de_rastreo || "")
      });
    }
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "virtual_account",
      target_entity_id: String(vaId)
    }).eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        skipped: "non_credit_activity_status",
        activity_type: activityType,
        deposit_id: receiptDepositId || depositId || null,
        status: nonCreditStatus,
        notified,
        reversal
      }
    });
    return;
  }
  if (!isFiatVirtualAccountCreditEvent(activityType, currency, eventCurrency)) {
    const isConvertedSettlement = isConvertedVirtualAccountSettlementEvent(activityType, currency, eventCurrency);
    const depositId = String(d?.deposit_id ?? "").trim();
    // A converted settlement reports `amount`/`currency` as the destination
    // wallet leg (for example 65.24 USDC), while receipt.initial_amount,
    // receipt.developer_fee and receipt.subtotal_amount remain in the source
    // fiat currency (for example 50.00 GBP). Never parse the destination
    // amount using the VA/source currency.
    const statusBreakdown = isConvertedSettlement ? null : receivedAmountBreakdown(d, currency);
    const statusReceipt = bridgeVaReceiptDetails({
      payload: d,
      sourceCurrency: currency,
      eventCurrency,
      vaId,
      accountDetails,
      breakdown: statusBreakdown
    });
    const receiptDepositId = String(statusReceipt.deposit_id || depositId || "").trim();
    const approvedStatus = normalizeTransactionEmailStatus(activityType) === "approved" || activityType === "payment_processed";
    if (isConvertedSettlement && approvedStatus && hasExplicitBridgeDeveloperFee(d)) {
      await recordBridgeWebhookRevenue({
        event: ev,
        sourceType: "bridge_virtual_account",
        sourceId: receiptDepositId || depositId || ev.event_id,
        feeCurrency: String(statusReceipt.source_currency || currency).toUpperCase(),
        grossCustomerFee: firstFiniteNumber(statusReceipt.service_charge_amount),
        sourceAmount: firstFiniteNumber(statusReceipt.source_amount),
        sourceCurrency: String(statusReceipt.source_currency || currency).toUpperCase(),
        destinationCurrency: String(statusReceipt.destination_currency || eventCurrency).toUpperCase(),
        occurredAt: d?.created_at ?? ev.payload?.event_created_at,
        rawObject: d
      });
    }
    const destinationAmountMinor = isConvertedSettlement ? toMinorUnits(statusReceipt.destination_amount, eventCurrency) : null;
    if (isConvertedSettlement && approvedStatus && destinationAmountMinor !== null && destinationAmountMinor > 0n) {
      const amountDecimal = minorToDecimal(destinationAmountMinor, eventCurrency);
      const amountLabel = formatMinorUnits(destinationAmountMinor, eventCurrency);
      const statusMetadata = {
        source: "bridge",
        kind: "virtual_account_deposit_status",
        bridge_event_id: ev.event_id,
        virtual_account_id: String(vaId),
        deposit_id: receiptDepositId || depositId || null,
        status: "approved",
        activity_type: activityType,
        amount: amountDecimal,
        currency: eventCurrency,
        source_currency: String(statusReceipt.source_currency || currency),
        source_amount: statusReceipt.source_amount ?? null,
        service_charge_amount: statusReceipt.service_charge_amount ?? null,
        available_amount: statusReceipt.available_amount ?? null,
        destination_currency: String(statusReceipt.destination_currency || eventCurrency),
        destination_amount: amountDecimal,
        direction: "credit",
        converted_currency: eventCurrency,
        balance_impact: "none",
        receipt: statusReceipt
      };
      const { resolved, account_type } = owner;
      await insertTransactionStatusNotification({
        userId: resolved,
        status: "approved",
        amountLabel,
        metadata: statusMetadata,
        idempotencyMatch: receiptDepositId || depositId ? {
          deposit_id: receiptDepositId || depositId,
          kind: "virtual_account_deposit_status",
          status: "approved"
        } : {
          bridge_event_id: ev.event_id,
          kind: "virtual_account_deposit_status",
          status: "approved"
        }
      });
      await emailTransactionStatusBestEffort({
        userId: resolved,
        accountType: account_type,
        status: "approved",
        amount: amountDecimal,
        currency: eventCurrency,
        reference: receiptDepositId || String(d?.reference ?? d?.source?.tracking_number ?? ev.event_id),
        description: "Deposit processed",
        occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null,
        idempotencyKey: `wh:tx-status:${resolved}:va:${receiptDepositId || ev.event_id}:approved`,
        grossAmount: null,
        developerFeeAmount: null,
        exchangeFeeAmount: null,
        netAmount: amountDecimal,
        sourceCurrency: String(statusReceipt.source_currency || currency),
        sourceAmount: Number(statusReceipt.source_amount ?? NaN),
        serviceChargeAmount: Number(statusReceipt.service_charge_amount ?? NaN),
        availableAmount: Number(statusReceipt.available_amount ?? NaN),
        destinationCurrency: String(statusReceipt.destination_currency || eventCurrency),
        destinationAmount: Number(statusReceipt.destination_amount ?? NaN),
        exchangeRate: Number(statusReceipt.exchange_rate ?? NaN),
        destinationAddress: String(statusReceipt.destination_address || ""),
        destinationRail: String(statusReceipt.destination_rail || ""),
        sourceRail: String(statusReceipt.source_rail || ""),
        depositId: receiptDepositId || null,
        receiptKind: "money_in_conversion",
        sourceBankName: String(statusReceipt.source_bank_name || ""),
        sourceBankAccount: String(statusReceipt.source_bank_account || ""),
        paymentReferenceText: String(statusReceipt.payment_reference_text || ""),
        receivingBankName: String(statusReceipt.receiving_bank_name || ""),
        receivingAccountName: String(statusReceipt.receiving_account_name || ""),
        receivingAccountNumber: String(statusReceipt.receiving_account_number || ""),
        traceId: String(statusReceipt.trace_id || ""),
        imad: String(statusReceipt.imad || ""),
        uetr: String(statusReceipt.uetr || ""),
        claveDeRastreo: String(statusReceipt.clave_de_rastreo || "")
      });
    }
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "virtual_account",
      target_entity_id: String(vaId)
    }).eq("event_id", ev.event_id);
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
        skipped: isConvertedSettlement ? "converted_settlement_status_only" : "non_credit_activity_status"
      }
    });
    return;
  }
  const approvedBreakdown = receivedAmountBreakdown(d, currency);
  const amountMinor = approvedBreakdown?.netMinor ?? toMinorUnits(d?.amount, currency);
  if (amountMinor === null) {
    // Malformed or unsupported currency. Audit + complete; do NOT mutate balance.
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "virtual_account",
      target_entity_id: String(vaId)
    }).eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        skipped: "unsupported_or_malformed_amount",
        currency,
        amount_raw: d?.amount
      }
    });
    return;
  }
  if (amountMinor <= 0n) {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        skipped: "non_positive_net_amount",
        amount_minor: amountMinor.toString(),
        gross_amount_minor: approvedBreakdown ? approvedBreakdown.grossMinor.toString() : null,
        developer_fee_minor: approvedBreakdown ? approvedBreakdown.developerFeeMinor.toString() : null,
        exchange_fee_minor: approvedBreakdown ? approvedBreakdown.exchangeFeeMinor.toString() : null
      }
    });
    return;
  }
  const { resolved, account_type } = owner;
  const depositId = String(d?.deposit_id ?? "").trim();
  const approvedReceipt = bridgeVaReceiptDetails({
    payload: d,
    sourceCurrency: currency,
    eventCurrency,
    vaId,
    accountDetails,
    breakdown: approvedBreakdown
  });
  const receiptDepositId = String(approvedReceipt.deposit_id || depositId || "").trim();
  const creditEventId = receiptDepositId ? `bridge:va:${String(vaId)}:deposit:${receiptDepositId}` : ev.event_id;
  // `funds_received` and equivalent fiat-credit activities are not terminal.
  // Bridge may still move the deposit to review, reject, or refund it. Revenue
  // is recognized only by the terminal converted-settlement branch above.
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
      receipt: approvedReceipt
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
      occurredAt: d?.created_at ?? ev.payload?.event_created_at ?? null
    });
    await insertTransactionStatusNotification({
      userId: resolved,
      status: "approved",
      amountLabel,
      metadata: statusMetadata,
      idempotencyMatch: receiptDepositId || depositId ? {
        deposit_id: receiptDepositId || depositId,
        kind: "virtual_account_deposit_status",
        status: "approved"
      } : {
        bridge_event_id: ev.event_id,
        kind: "virtual_account_deposit_status",
        status: "approved"
      }
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
      destinationRail: String(approvedReceipt.destination_rail || ""),
      sourceRail: String(approvedReceipt.source_rail || ""),
      depositId: receiptDepositId || null,
      sourceBankName: String(approvedReceipt.source_bank_name || ""),
      sourceBankAccount: String(approvedReceipt.source_bank_account || ""),
      paymentReferenceText: String(approvedReceipt.payment_reference_text || ""),
      receivingBankName: String(approvedReceipt.receiving_bank_name || ""),
      receivingAccountName: String(approvedReceipt.receiving_account_name || ""),
      receivingAccountNumber: String(approvedReceipt.receiving_account_number || ""),
      traceId: String(approvedReceipt.trace_id || ""),
      imad: String(approvedReceipt.imad || ""),
      uetr: String(approvedReceipt.uetr || ""),
      claveDeRastreo: String(approvedReceipt.clave_de_rastreo || "")
    });
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "virtual_account",
      target_entity_id: String(vaId)
    }).eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "virtual_account",
        virtual_account_id: vaId,
        deposit_id: depositId || null,
        credited: false,
        delivered_to: "external_wallet",
        amount_minor: amountMinor.toString()
      }
    });
    return;
  }
  // Canonical Bridge balance + auditable ledger. Idempotent on event_id.
  const { data: creditResult, error: creditErr } = await supabase.rpc("apply_bridge_va_credit", {
    p_event_id: creditEventId,
    p_bridge_va_id: String(vaId),
    p_user_id: account_type === "individual" ? resolved : null,
    p_business_user_id: account_type === "business" ? resolved : null,
    p_currency: currency,
    // PostgREST serialises bigint via JSON — pass as string to avoid float coercion.
    p_amount_minor: amountMinor.toString(),
    p_metadata: {
      source: "bridge",
      webhook_event_id: ev.event_id,
      credit_event_id: creditEventId,
      virtual_account: vaId,
      bridge_customer: customer,
      deposit_id: receiptDepositId || depositId || null,
      developer_fee_percent: owner.developer_fee_percent,
      gross_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
      developer_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
      exchange_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
      net_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null,
      reference: d?.reference ?? null,
      receipt: approvedReceipt,
      raw: d
    }
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
      receipt: approvedReceipt
    };
    await insertTransactionStatusNotification({
      userId: resolved,
      status: "approved",
      amountLabel,
      metadata: statusMetadata,
      idempotencyMatch: receiptDepositId || depositId ? {
        deposit_id: receiptDepositId || depositId,
        kind: "virtual_account_deposit_status",
        status: "approved"
      } : {
        bridge_event_id: ev.event_id,
        kind: "virtual_account_deposit_status",
        status: "approved"
      }
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
      p_event_id: ev.event_id,
      p_user_id: resolved,
      p_currency: currency,
      p_amount: amountDecimal,
      p_tx_reference: `bridge:${ev.event_id}`,
      p_tx_metadata: {
        virtual_account_id: vaId,
        bridge_reference: d?.reference ?? null,
        payload: d,
        mirror_of: "bridge_balance_ledger",
        gross_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.grossMinor, currency) : null,
        developer_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.developerFeeMinor, currency) : null,
        exchange_fee_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.exchangeFeeMinor, currency) : null,
        net_amount: approvedBreakdown ? minorToDecimal(approvedBreakdown.netMinor, currency) : null
      }
    });
    if (mirrorErr) {
      throw new Error(`apply_bridge_wallet_credit_and_complete failed: ${mirrorErr.message}`);
    }
    // Backlink the webhook event to the VA for ops visibility (the RPC does
    // not touch bridge_webhook_events; we always set the entity backlink
    // for the activity branch here).
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "virtual_account",
      target_entity_id: String(vaId)
    }).eq("event_id", ev.event_id);
    return;
  }
  await supabase.from("bridge_webhook_events").update({
    target_entity_type: "virtual_account",
    target_entity_id: String(vaId)
  }).eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "virtual_account",
      virtual_account_id: vaId,
      applied: creditRow?.applied ?? false,
      new_balance_minor: creditRow?.new_balance_minor ?? null
    }
  });
}
async function handleBridgeWallet(ev) {
  // Bridge envelope: event_object is the wallet; event_object_id its id.
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const walletId = d?.wallet_id ?? d?.bridge_wallet_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!walletId) throw new Error("bridge wallet event missing wallet_id");
  const payloadCustomer = d?.customer_id ?? d?.customer?.id ?? d?.bridge_customer_id ?? d?.bridge_wallet?.customer_id;
  let customer = payloadCustomer ? String(payloadCustomer) : "";
  let resolved = "";
  let account_type = "individual";
  const t = ev.event_type.toLowerCase();
  const isActivity = t.includes("activity") || t.includes("deposit") || t.includes("credit");
  if (customer) {
    const owner = await resolveOwnerFromBridgeCustomer(customer);
    resolved = owner.resolved;
    account_type = owner.account_type;
  } else {
    const { data: mappedWallet } = await supabase.from("bridge_wallets").select("bridge_customer_id,user_id,business_user_id").eq("bridge_wallet_id", String(walletId)).maybeSingle();
    if (!mappedWallet?.bridge_customer_id) {
      const rawAmount = Number(d?.amount);
      const isFinancialActivity = isActivity && Number.isFinite(rawAmount) && rawAmount > 0;
      if (isFinancialActivity) {
        throw new Error("reconciliation_required:wallet_activity_missing_customer_mapping");
      }
      await supabase.from("bridge_webhook_events").update({
        target_entity_type: "wallet",
        target_entity_id: String(walletId)
      }).eq("event_id", ev.event_id);
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary: {
          source: "bridge",
          kind: "wallet",
          wallet_id: walletId,
          reconciliation_required: "wallet_activity_missing_customer_mapping"
        }
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
  const isDirectWalletDeposit = walletActivityDirection === "credit" && [
    "direct_deposit",
    "deposit"
  ].includes(walletActivityType) && paymentRouteType !== "virtual_account_event";
  const walletActivityAmount = amountMinor !== null ? minorToDecimal(absMinor(amountMinor), currency) : Math.abs(amountValue);
  const shouldProjectWalletActivityTx = isActivity && walletActivityDirection !== null && Number.isFinite(walletActivityAmount) && walletActivityAmount > 0 && !!resolved;
  await supabase.from("bridge_wallets").upsert({
    bridge_wallet_id: String(walletId),
    bridge_customer_id: String(customer),
    user_id: account_type === "individual" ? resolved : null,
    business_user_id: account_type === "business" ? resolved : null,
    currency: String(d?.currency ?? "usdc").toLowerCase(),
    chain: String(d?.chain ?? "base").toLowerCase(),
    address: String(d?.address ?? d?.deposit_address ?? ""),
    status: String(d?.status ?? "active").toLowerCase(),
    updated_at: new Date().toISOString()
  }, {
    onConflict: "bridge_wallet_id"
  });
  // Projection repair/prevention: wallet activity with amount should emit a
  // canonical ledger/transaction row idempotently. Customer-facing
  // notifications are owned by the deposit/transfer lifecycle handlers, not
  // raw wallet activity, otherwise one Bridge movement appears twice.
  if (shouldProjectWalletActivityTx && walletActivityDirection) {
    const txReference = `bridge:${ev.event_id}`;
    await supabase.from("transactions").upsert({
      user_id: resolved,
      type: walletActivityDirection === "credit" ? "deposit" : "withdrawal",
      amount: walletActivityAmount,
      currency,
      status: "completed",
      reference: txReference,
      metadata: {
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
        raw: d
      },
      provider: "bridge",
      description: walletActivityDirection === "credit" ? "Wallet deposit credit" : "Wallet transfer debit",
      updated_at: new Date().toISOString()
    }, {
      onConflict: "reference"
    });
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
          raw: d
        }
      }, {
        onConflict: "event_id",
        ignoreDuplicates: true
      });
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
        idempotencyKey: `wh:wallet-activity:${resolved}:${walletActivityTransferId || d?.id || ev.event_id}:credit`
      });
    }
  }
  await supabase.from("bridge_webhook_events").update({
    target_entity_type: "wallet",
    target_entity_id: String(walletId)
  }).eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "wallet",
      wallet_id: walletId,
      ...isActivity && walletActivityDirection === null && Number.isFinite(walletActivityAmount) && walletActivityAmount > 0 ? {
        reconciliation_required: "wallet_activity_direction_unresolved",
        financial_write_blocked: true
      } : {}
    }
  });
}
async function handleBridgeExternalAccount(ev) {
  const t = ev.event_type.toLowerCase();
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const externalAccountId = d?.external_account_id ?? d?.id ?? ev.payload?.event_object_id;
  if (!externalAccountId) {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "external_account",
        skipped: "missing_external_account_id"
      }
    });
    return;
  }
  const customer = d?.customer_id ?? d?.customer?.id;
  if (!customer) {
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "external_account",
        external_account_id: String(externalAccountId),
        skipped: "missing_customer_id"
      }
    });
    return;
  }
  const owner = await resolveOwnerFromBridgeCustomer(String(customer));
  await syncCountryFromBridgeCustomer(String(customer), owner);
  const status = String(d?.status ?? "").toLowerCase() || (t.includes("deleted") || t.includes("deactivated") ? "deleted" : "active");
  const active = ![
    "deleted",
    "deactivated",
    "inactive",
    "disabled",
    "closed"
  ].includes(status);
  const accountType = String(d?.account_type ?? d?.type ?? "").toLowerCase();
  const currency = String(d?.currency ?? d?.bank_account?.currency ?? "").toUpperCase();
  const last4 = String(d?.last_4 ?? d?.account_last4 ?? d?.bank_account?.account_last4 ?? d?.bank_account?.last_4 ?? "");
  const ownerName = String(d?.account_owner_name ?? d?.owner_name ?? d?.bank_account?.account_owner_name ?? "");
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
    updated_at: new Date().toISOString()
  }, {
    onConflict: "bridge_external_account_id"
  });
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "external_account",
      external_account_id: String(externalAccountId),
      status,
      active,
      recognized_event: t.endsWith(".created") || t.endsWith(".updated") || t.endsWith(".deleted")
    }
  });
}
async function handleBridgeLiquidationDrain(ev) {
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const drainId = firstNonEmptyText(d?.id, ev.payload?.event_object_id);
  if (!drainId) throw new Error("liquidation drain id is required");
  const state = String(d?.state ?? d?.status ?? "").trim().toLowerCase();
  const receipt = objectValue(d?.receipt) ?? {};
  const sourceCurrency = String(d?.currency ?? "").trim().toUpperCase();
  const destinationCurrency = String(receipt.destination_currency ?? d?.destination?.currency ?? "").trim().toUpperCase();
  const sourceAmount = firstFiniteNumber(receipt.initial_amount, d?.amount);
  const developerFee = firstFiniteNumber(receipt.developer_fee);
  const occurredAt = d?.updated_at ?? d?.created_at ?? ev.payload?.event_created_at;
  if ([
    "payment_processed",
    "succeeded",
    "completed",
    "complete"
  ].includes(state)) {
    if (sourceAmount === null || developerFee === null || !sourceCurrency || !destinationCurrency) {
      throw new Error("liquidation drain terminal fee evidence is incomplete");
    }
    const { error } = await supabase.rpc("record_bridge_liquidation_drain_revenue", {
      p_source_id: drainId,
      p_source_event_id: ev.event_id,
      p_event_kind: "earned",
      p_source_amount: sourceAmount,
      p_source_currency: sourceCurrency,
      p_destination_currency: destinationCurrency,
      p_developer_fee: developerFee,
      p_evidence: {
        source: "bridge_webhook_events",
        signature_verified_at_ingress: true,
        queue_event_id: ev.event_id,
        event_type: ev.event_type,
        event_object: d
      },
      p_occurred_at: occurredAt
    });
    if (error) throw new Error(`record_bridge_liquidation_drain_revenue failed: ${error.message}`);
  } else if ([
    "refunded",
    "returned",
    "canceled",
    "cancelled",
    "refund_complete",
    "refund_completed"
  ].includes(state)) {
    const { error } = await supabase.rpc("record_bridge_liquidation_drain_revenue", {
      p_source_id: drainId,
      p_source_event_id: ev.event_id,
      p_event_kind: "reversal",
      p_source_amount: null,
      p_source_currency: null,
      p_destination_currency: null,
      p_developer_fee: null,
      p_evidence: {
        source: "bridge_webhook_events",
        signature_verified_at_ingress: true,
        queue_event_id: ev.event_id,
        event_type: ev.event_type,
        event_object: d
      },
      p_occurred_at: occurredAt
    });
    if (error) throw new Error(`reverse_bridge_liquidation_drain_revenue failed: ${error.message}`);
  }
  await supabase.from("bridge_webhook_events").update({
    target_entity_type: "liquidation_address_drain",
    target_entity_id: drainId
  }).eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "liquidation_address_drain",
      drain_id: drainId,
      state
    }
  });
}
async function handleBridgeTransfer(ev) {
  // Bridge envelope: event_object is the transfer; event_object_id its id.
  const d = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const transferId = d?.transfer_id ?? d?.id ?? ev.payload?.event_object_id;
  const customer = d?.customer_id ?? d?.customer?.id ?? d?.source?.customer_id ?? d?.destination?.customer_id;
  if (!transferId) throw new Error("bridge transfer event missing id");
  const providerState = String(d?.state ?? d?.status ?? "").toLowerCase();
  const mappedState = mapBridgeTransferState(providerState);
  if (!mappedState.recognized) {
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "transfer",
      target_entity_id: String(transferId)
    }).eq("event_id", ev.event_id);
    throw new Error(`reconciliation_required:unknown_transfer_state:${mappedState.providerState}`);
  }
  let owner = {
    resolved: null,
    account_type: null
  };
  let reconciliationReason = null;
  if (!customer) {
    reconciliationReason = "missing_customer_id";
  } else {
    try {
      owner = await resolveOwnerFromBridgeCustomer(customer);
    } catch (e) {
      reconciliationReason = `owner_unmapped_for_customer:${String(customer)}`;
      console.error(`bridge transfer reconciliation required for transfer=${transferId}: ${e.message}`);
    }
  }
  const normSource = normalizeBridgeEndpointType(d?.source?.type ?? d?.source?.payment_rail ?? "external_bank");
  const normDest = normalizeBridgeEndpointType(d?.destination?.type ?? d?.destination?.payment_rail ?? "external_bank");
  const direction = bridgeTransferDirection(normSource, normDest);
  const transactionType = direction === "debit" ? "withdrawal" : "deposit";
  const amount = Number(d?.amount ?? 0);
  const currency = String(d?.currency ?? d?.source?.currency ?? "USD").toUpperCase();
  const receiptBreakdown = transferReceiptBreakdown(d, currency);
  const displayAmount = receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : amount;
  // 1) Bridge transfer projection + lifecycle state must flow via canonical RPC
  // (no direct runtime upsert on bridge_transfers).
  const transferState = mappedState.recognized ? mappedState.providerState === "payment_processed" ? "succeeded" : mappedState.providerState === "canceled" ? "cancelled" : [
    "returned",
    "refunded"
  ].includes(mappedState.providerState) ? mappedState.providerState : mappedState.transactionStatus === "failed" ? "failed" : "pending" : "pending";
  const transferRaw = {
    ...d,
    borderpay_reconciliation_reason: reconciliationReason,
    borderpay_provider_state_recognized: mappedState.recognized
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
    p_raw: transferRaw
  });
  if (btErr) {
    throw new Error(`upsert_bridge_transfer_projection failed: ${btErr.message}`);
  }
  // Maintenance collections are a dedicated treasury movement. They must not
  // enter the generic payout/revenue/email pipeline. Only this signed Bridge
  // lifecycle event is allowed to complete the subscription charge.
  const { data: maintenanceLeg, error: maintenanceLookupError } = await supabase.from("subscription_bridge_collection_legs").select("id,collection_id").eq("provider_transfer_id", String(transferId)).maybeSingle();
  if (maintenanceLookupError) {
    throw new Error(`subscription collection lookup failed: ${maintenanceLookupError.message}`);
  }
  if (maintenanceLeg?.id) {
    const { data: reconciliation, error: reconciliationError } = await supabase.rpc("reconcile_bridge_subscription_collection_leg", {
      p_provider_transfer_id: String(transferId),
      p_provider_state: mappedState.providerState,
      p_event_id: ev.event_id
    });
    if (reconciliationError) {
      throw new Error(`subscription collection reconciliation failed: ${reconciliationError.message}`);
    }
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "subscription_bridge_collection",
      target_entity_id: String(maintenanceLeg.collection_id)
    }).eq("event_id", ev.event_id);
    await supabase.rpc("complete_pending_event", {
      p_event_id: ev.event_id,
      p_summary: {
        source: "bridge",
        kind: "subscription_bridge_collection",
        collection_id: maintenanceLeg.collection_id,
        transfer_id: String(transferId),
        provider_state: mappedState.providerState,
        reconciliation
      }
    });
    return;
  }
  if (transferState === "succeeded" && hasExplicitBridgeDeveloperFee(d)) {
    const sourceCurrency = firstNonEmptyText(d?.receipt?.source_currency, d?.source?.currency, currency)?.toUpperCase() ?? currency;
    const destinationCurrency = firstNonEmptyText(d?.receipt?.destination_currency, d?.destination?.currency, d?.destination_currency)?.toUpperCase() ?? null;
    await recordBridgeWebhookRevenue({
      event: ev,
      sourceType: "bridge_transfer",
      sourceId: String(transferId),
      feeCurrency: sourceCurrency,
      grossCustomerFee: receiptBreakdown ? minorToDecimal(receiptBreakdown.developerFeeMinor, sourceCurrency) : null,
      sourceAmount: receiptBreakdown ? minorToDecimal(receiptBreakdown.grossMinor, sourceCurrency) : firstFiniteNumber(d?.amount),
      sourceCurrency,
      destinationCurrency,
      occurredAt: d?.updated_at ?? d?.created_at ?? ev.payload?.event_created_at,
      rawObject: d
    });
  }
  if (transferState === "refunded" || transferState === "returned") {
    await reverseBridgeWebhookRevenue({
      event: ev,
      sourceType: "bridge_transfer",
      sourceId: String(transferId),
      occurredAt: d?.updated_at ?? d?.created_at ?? ev.payload?.event_created_at,
      rawObject: d
    });
  }
  if (reconciliationReason) {
    await supabase.from("bridge_webhook_events").update({
      target_entity_type: "transfer",
      target_entity_id: String(transferId)
    }).eq("event_id", ev.event_id);
    throw new Error(`reconciliation_required:${reconciliationReason}`);
  }
  // A fiat-deposit return is itself a Bridge transfer. Reconcile the
  // operator-created return operation from the signed transfer lifecycle;
  // never treat the POST response as terminal proof.
  const { data: returnOperation, error: returnLookupError } = await supabase.from("bridge_return_operations").select("id,case_id,status").eq("bridge_transfer_id", String(transferId)).maybeSingle();
  if (returnLookupError) throw new Error(`bridge return operation lookup failed: ${returnLookupError.message}`);
  if (returnOperation?.id) {
    const operationStatus = transferState === "succeeded" ? "completed" : transferState === "failed" ? "failed" : transferState === "cancelled" ? "canceled" : [
      "returned",
      "refunded"
    ].includes(transferState) ? "returned" : "pending";
    const terminal = [
      "completed",
      "failed",
      "canceled",
      "returned"
    ].includes(operationStatus);
    const { error: returnUpdateError } = await supabase.from("bridge_return_operations").update({
      status: operationStatus,
      response_payload: d,
      error_message: [
        "failed",
        "canceled",
        "returned"
      ].includes(operationStatus) ? `Bridge return transfer reached ${operationStatus}` : null,
      updated_at: new Date().toISOString(),
      completed_at: terminal ? new Date().toISOString() : null
    }).eq("id", returnOperation.id);
    if (returnUpdateError) throw new Error(`bridge return operation reconciliation failed: ${returnUpdateError.message}`);
    const { error: caseUpdateError } = await supabase.from("bridge_compliance_cases").update({
      status: operationStatus === "completed" ? "return_completed" : terminal ? "return_failed" : "return_submitted",
      updated_at: new Date().toISOString(),
      closed_at: operationStatus === "completed" ? new Date().toISOString() : null
    }).eq("id", returnOperation.case_id);
    if (caseUpdateError) throw new Error(`bridge compliance case reconciliation failed: ${caseUpdateError.message}`);
  }
  // 2. Mirror into public.transactions so existing readers (TransactionsScreen,
  //    exports, admin views) reflect Bridge activity. Idempotent via the
  //    partial unique index transactions_bridge_transfer_uniq. The schema only
  //    carries user_id today, so for businesses we use the owner's auth.uid
  //    and tag metadata.account_type='business' — no business transaction
  //    schema invented here per CTO directive.
  if (owner.resolved) {
    const { error: txErr } = await supabase.rpc("upsert_bridge_transaction", {
      p_user_id: owner.resolved,
      p_bridge_transfer_id: String(transferId),
      p_amount: amount,
      p_currency: currency,
      p_status: mappedState.transactionStatus,
      p_metadata: {
        source: "bridge",
        transaction_type: transactionType,
        direction,
        balance_impact: direction,
        flow: "bridge_transfer",
        account_type: owner.account_type,
        source_type: normSource,
        destination_type: normDest,
        bridge_state: mappedState.providerState,
        bridge_state_recognized: mappedState.recognized,
        receipt: receiptBreakdown ? {
          initial_amount: minorToDecimal(receiptBreakdown.grossMinor, currency),
          developer_fee: minorToDecimal(receiptBreakdown.developerFeeMinor, currency),
          exchange_fee: minorToDecimal(receiptBreakdown.exchangeFeeMinor, currency),
          final_amount: minorToDecimal(receiptBreakdown.netMinor, currency)
        } : d?.receipt ?? null,
        gross_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.grossMinor, currency) : null,
        developer_fee_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.developerFeeMinor, currency) : null,
        exchange_fee_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.exchangeFeeMinor, currency) : null,
        net_amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : null,
        raw: d
      }
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
        p_payload: d
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
        currency
      };
      await insertTransactionStatusNotification({
        userId: owner.resolved,
        status: emailStatus,
        amountLabel,
        metadata: statusMetadata,
        idempotencyMatch: {
          bridge_transfer_id: String(transferId),
          kind: "transfer_status",
          status: emailStatus
        }
      });
      if (direction === "debit" && emailStatus === "approved") {
        // A successful wallet-originated Bridge transfer is money out. Use the
        // dedicated debit receipt rather than the money-in status template.
        // The gross amount is what left the BorderPay wallet; the provider
        // receipt remains authoritative for fee/revenue reconciliation.
        await emailWalletActivityBestEffort({
          userId: owner.resolved,
          accountType: owner.account_type ?? "individual",
          direction: "debit",
          amount: receiptBreakdown ? minorToDecimal(receiptBreakdown.grossMinor, currency) : amount,
          currency,
          reference: String(transferId),
          description: "Payment sent",
          occurredAt: d?.updated_at ?? d?.created_at ?? ev.payload?.event_created_at ?? null,
          idempotencyKey: `wh:wallet-activity:${owner.resolved}:transfer:${String(transferId)}:debit:completed`
        });
      } else {
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
          netAmount: receiptBreakdown ? minorToDecimal(receiptBreakdown.netMinor, currency) : null
        });
      }
    }
  }
  await supabase.from("bridge_webhook_events").update({
    target_entity_type: "transfer",
    target_entity_id: String(transferId)
  }).eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary: {
      source: "bridge",
      kind: "transfer",
      transfer_id: transferId,
      provider_state: mappedState.providerState,
      internal_status: mappedState.transactionStatus,
      recognized: mappedState.recognized
    }
  });
}
async function ensureStablecoinWalletsProvisioned(input) {
  const { data: operatorRow, error: operatorLookupError } = await supabase.from("operator_bridge_accounts").select("bridge_customer_id").eq("bridge_customer_id", input.bridgeCustomerId).eq("active", true).maybeSingle();
  if (operatorLookupError) {
    throw new Error(`operator_bridge_accounts lookup failed: ${operatorLookupError.message}`);
  }
  if (operatorRow?.bridge_customer_id) {
    // Imported Bridge operator/admin accounts are not BorderPay customer
    // lifecycle subjects. Skip auto-provisioning entirely.
    return;
  }
  const jurisdiction = await loadBridgeEeaWalletSecurityEnrollment(supabase, input.userId, input.bridgeCustomerId);
  if (!jurisdiction.country) {
    console.info("bridge_wallet_auto_provision_deferred", {
      user_id: input.userId,
      bridge_customer_id: input.bridgeCustomerId,
      reason: "business_incorporation_country_unavailable",
    });
    return;
  }
  if (jurisdiction.required) {
    console.info("bridge_eea_wallet_auto_provision_skipped", {
      user_id: input.userId,
      bridge_customer_id: input.bridgeCustomerId,
      missing: jurisdiction.missing,
    });
    return;
  }
  const profileTable = input.accountType === "business" ? "business_profiles" : "user_profiles";
  const idCol = input.accountType === "business" ? "user_id" : "id";
  const statusCol = input.accountType === "business" ? "bridge_kyb_status" : "bridge_kyc_status";
  const { data: profile } = await supabase.from(profileTable).select(`country, ${statusCol}`).eq(idCol, input.userId).maybeSingle();
  const country = jurisdiction.country;
  if (isBridgeBlocked(country) || !isBridgeCustodialWalletSupported(country)) return;
  const statusValue = profile?.[statusCol];
  if (String(statusValue || "").toLowerCase() !== "approved") return;
  for (const { symbol, chain } of bridgeAutomaticWalletsForCountry(country)){
    const chainLc = chain.toLowerCase();
    const { data: existing, error: existingLookupError } = await supabase.from("bridge_wallets").select("bridge_wallet_id,address,status").eq("bridge_customer_id", input.bridgeCustomerId).ilike("currency", symbol).ilike("chain", chainLc).maybeSingle();
    if (existingLookupError) {
      throw new Error(`bridge_wallets lookup failed for ${symbol}/${chainLc}: ${existingLookupError.message}`);
    }
    const existingActive = String(existing?.status || "").toLowerCase() === "active";
    if (existing?.bridge_wallet_id && existingActive && existing.address) continue;
    if (existing?.bridge_wallet_id && !existingActive) {
      throw new Error(`existing ${symbol}/${chainLc} wallet is ${existing.status || "not_active"}`);
    }
    const lock = await tryAcquireProvisioningLock(input.bridgeCustomerId, symbol, chainLc);
    if (lock.state === "busy") {
      throw new Error(`wallet provisioning already in progress for ${symbol}/${chainLc}`);
    }
    try {
      const created = await bridgeProvider.createWallet({
        customer_id: input.bridgeCustomerId,
        symbol,
        chain
      });
      const { error: bridgeWalletErr } = await supabase.from("bridge_wallets").upsert({
        bridge_wallet_id: created.wallet_id,
        bridge_customer_id: input.bridgeCustomerId,
        user_id: input.accountType === "individual" ? input.userId : null,
        business_user_id: input.accountType === "business" ? input.userId : null,
        currency: symbol,
        chain: chainLc,
        address: created.deposit_address,
        status: "active",
        updated_at: new Date().toISOString()
      }, {
        onConflict: "bridge_wallet_id"
      });
      if (bridgeWalletErr) {
        throw new Error(`bridge_wallets persistence failed for ${symbol}/${chainLc}: ${bridgeWalletErr.message}`);
      }
      await completeProvisioningLock(lock.lockEventId, "provisioned");
    } catch (e) {
      await failProvisioningLock(lock.lockEventId, describeWalletProvisioningError(e));
      throw e;
    }
  }
}
function describeWalletProvisioningError(error) {
  const value = error && typeof error === "object" ? error : {};
  return [
    error instanceof Error ? error.message : String(error || "provision_failed"),
    value.bridge_code ? `code=${String(value.bridge_code)}` : "",
    value.bridge_error ? `provider=${String(value.bridge_error)}` : "",
    value.raw_text ? `response=${String(value.raw_text).slice(0, 240)}` : "",
    value.request_id ? `request_id=${String(value.request_id)}` : ""
  ].filter(Boolean).join("; ").slice(0, 512);
}
async function syncCountryFromBridgeCustomer(bridgeCustomerId, owner) {
  const [{ data: userProfile }, { data: businessProfile }] = await Promise.all([
    supabase.from("user_profiles").select("country, phone, date_of_birth, id_number, id_type, bridge_address_object, bridge_identity_metadata").eq("id", owner.resolved).maybeSingle(),
    owner.account_type === "business" ? supabase.from("business_profiles").select("country, company_phone, address, city, state, postal_code, bridge_identity_metadata").eq("user_id", owner.resolved).maybeSingle() : Promise.resolve({
      data: null
    })
  ]);
  const userCountry = normalizeCountryCode(userProfile?.country);
  const businessCountry = normalizeCountryCode(businessProfile?.country);
  const cachedBridgeAddress = userProfile?.bridge_address_object && typeof userProfile.bridge_address_object === "object" ? userProfile.bridge_address_object : null;
  const cachedBridgeCountry = normalizeBridgeCountryCode(cachedBridgeAddress?.country ? String(cachedBridgeAddress.country) : null);
  // Bridge's generic/address country may represent where a business operates.
  // It may refresh an individual's residence, but it must never overwrite a
  // business's legal country of incorporation.
  const hasBridgeCountryMismatch = Boolean(owner.account_type !== "business" && cachedBridgeCountry && userCountry !== cachedBridgeCountry);
  const needsUserIdentity = !userProfile?.date_of_birth || !userProfile?.id_number || !userProfile?.id_type;
  const hasBusinessIdentityMetadata = businessProfile?.bridge_identity_metadata && typeof businessProfile.bridge_identity_metadata === "object" && Object.keys(businessProfile.bridge_identity_metadata).length > 0;
  const needsBusinessIdentity = owner.account_type === "business" && !hasBusinessIdentityMetadata;
  if (userCountry && !hasBridgeCountryMismatch && !needsUserIdentity && (owner.account_type !== "business" || businessCountry && !needsBusinessIdentity)) return;
  let customer = null;
  try {
    customer = await bridgeProvider.getCustomerProfile(bridgeCustomerId);
  } catch (e) {
    // Do not fail financial event processing if customer-profile read is
    // unavailable in Bridge for an imported historical customer mapping.
    console.warn(`country-sync skipped customer=${bridgeCustomerId}: ${e.message}`);
    return;
  }
  const bridgeCountry = normalizeCountryCode(normalizeBridgeCountryCode(customer.country ?? customer.address_object?.country));
  const userUpdate = {
    updated_at: new Date().toISOString()
  };
  if (owner.account_type !== "business" && bridgeCountry && userCountry !== bridgeCountry) userUpdate.country = bridgeCountry;
  if (!userProfile?.phone && customer.phone) userUpdate.phone = customer.phone;
  if (!userProfile?.date_of_birth && customer.date_of_birth) userUpdate.date_of_birth = customer.date_of_birth;
  if (!userProfile?.id_number && customer.id_number) userUpdate.id_number = customer.id_number;
  if (!userProfile?.id_type && customer.id_type) userUpdate.id_type = customer.id_type;
  if (customer.id_number || customer.id_type || customer.date_of_birth || customer.identity_metadata.id_number_present) {
    userUpdate.bridge_identity_metadata = {
      ...userProfile?.bridge_identity_metadata && typeof userProfile.bridge_identity_metadata === "object" ? userProfile.bridge_identity_metadata : {},
      ...customer.identity_metadata
    };
    userUpdate.bridge_identity_synced_at = new Date().toISOString();
  }
  if (customer.address_object && Object.values(customer.address_object).some((v)=>String(v ?? "").trim().length > 0)) {
    userUpdate.bridge_address_object = customer.address_object;
    if (owner.account_type !== "business" && bridgeCountry && userCountry !== bridgeCountry) userUpdate.country = bridgeCountry;
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
    const bizUpdate = {
      updated_at: new Date().toISOString()
    };
    if (!businessProfile?.company_phone && customer.phone) bizUpdate.company_phone = customer.phone;
    if (customer.id_number || customer.id_type || customer.date_of_birth || customer.identity_metadata.id_number_present) {
      bizUpdate.bridge_identity_metadata = {
        ...businessProfile?.bridge_identity_metadata && typeof businessProfile.bridge_identity_metadata === "object" ? businessProfile.bridge_identity_metadata : {},
        ...customer.identity_metadata
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
async function resolveOwnerFromBridgeCustomer(bridgeCustomerId) {
  const { data: bizRows } = await supabase.from("business_profiles").select("user_id").eq("bridge_customer_id", String(bridgeCustomerId)).limit(2);
  const { data: userRows } = await supabase.from("user_profiles").select("id, account_type").eq("bridge_customer_id", String(bridgeCustomerId)).limit(2);
  const ownerMap = new Map();
  for (const row of Array.isArray(userRows) ? userRows : []){
    const ownerId = String(row?.id || "");
    if (!ownerId) continue;
    const type = row?.account_type === "business" ? "business" : "individual";
    ownerMap.set(ownerId, type);
  }
  for (const row of Array.isArray(bizRows) ? bizRows : []){
    const ownerId = String(row?.user_id || "");
    if (!ownerId) continue;
    // business_profiles row is canonical for business ownership; upgrade type.
    ownerMap.set(ownerId, "business");
  }
  const owners = Array.from(ownerMap.entries()).map(([resolved, account_type])=>({
      resolved,
      account_type
    }));
  if (owners.length === 1) return owners[0];
  if (owners.length === 0) throw new Error(`no profile row for bridge_customer_id=${bridgeCustomerId}`);
  throw new Error(`ambiguous profile rows for bridge_customer_id=${bridgeCustomerId}`);
}
// ── claim & drain ────────────────────────────────────────────────────────
async function processOne(ev) {
  try {
    await processEvent(ev);
    if (ev.source === "bridge") await emailOperatorTransactionEventBestEffort(ev);
    return {
      ok: true
    };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    await supabase.rpc("fail_pending_event", {
      p_event_id: ev.event_id,
      p_error: msg,
      p_backoff_seconds: null
    });
    return {
      ok: false,
      error: msg
    };
  }
}
async function drain(batchSize = 25) {
  // Reap stale 'processing' rows whose worker died.
  await supabase.rpc("reap_stuck_processing", {
    p_lock_timeout_seconds: 300
  });
  const { data: claimed, error } = await supabase.rpc("claim_pending_events", {
    p_worker_id: WORKER_ID,
    p_batch_size: batchSize
  });
  if (error) throw error;
  const events = claimed ?? [];
  let ok = 0;
  let failed = 0;
  // Process serially within a worker invocation to keep memory low and to
  // stay well under Bridge's rate limits. For higher throughput, increase
  // invocation parallelism rather than per-worker concurrency.
  for (const ev of events){
    const r = await processOne(ev);
    if (r.ok) ok++;
    else failed++;
  }
  return {
    claimed: events.length,
    ok,
    failed
  };
}
// ── HTTP entrypoint ──────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      status: "alive",
      worker: WORKER_ID
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (!isAuthorizedWorkerRequest(req)) {
    return new Response(JSON.stringify({
      ok: false,
      error: "unauthorized worker request"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  // Path 1: Supabase Database Webhook payload — process exactly that record.
  if (body?.type === "INSERT" && body?.table === "pending_events" && body?.record?.event_id) {
    const eventId = body.record.event_id;
    // Canonical lifecycle mutation path only: claim via RPC and process drain.
    // We do not issue direct pending_events updates from the worker anymore.
    const result = await drain(1);
    return new Response(JSON.stringify({
      ...result,
      ok: true,
      mode: "insert_webhook_drain",
      requested_event_id: eventId
    }), {
      status: 200
    });
  }
  // Path 2: drain mode (pg_cron / manual ops).
  const batch = Math.min(Number(body?.batch_size ?? 25), 100);
  const result = await drain(batch);
  return new Response(JSON.stringify({
    ...result,
    ok: true,
    worker: WORKER_ID
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
