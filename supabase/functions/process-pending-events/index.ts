/**
 * process-pending-events — background worker for the unified webhook queue.
 *
 * Sources:
 *   • 'bridge'   — Bridge events (customer KYC/KYB, virtual accounts, wallets, transfers).
 *   • 'maplerad' — legacy events from before Maplerad was removed. The worker
 *                  no longer applies their effects; rows are completed with a
 *                  `{ provider_removed: "maplerad" }` summary to drain the queue.
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

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;

interface PendingEvent {
  id:           string;
  event_id:     string;
  source:       string;
  event_type:   string;
  payload:      Record<string, unknown>;
  attempts:     number;
  max_attempts: number;
}

// ── Top-level router (source-aware) ──────────────────────────────────────
//
// Bridge is the only active provider. Maplerad has been removed.
// Any pending_events row with source='maplerad' is a leftover from before
// removal — we mark it terminally completed with a `provider_removed` tag
// so the queue keeps draining without crediting wallets, flipping KYC
// status, or otherwise applying Maplerad-era business logic. Unknown
// source values get the same treatment (fail-closed, never fall through).

async function processEvent(ev: PendingEvent): Promise<void> {
  switch (ev.source) {
    case "bridge":
      return await processBridgeEvent(ev);

    case "maplerad":
      // Provider removed. Do NOT credit wallets or update KYC from these
      // events. Mark the row completed with a clear terminal reason.
      await supabase.rpc("complete_pending_event", {
        p_event_id: ev.event_id,
        p_summary:  {
          provider_removed: "maplerad",
          event_type:        ev.event_type,
          note:              "Maplerad has been removed; event dropped without side effects.",
        },
      });
      return;

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

async function processBridgeEvent(ev: PendingEvent): Promise<void> {
  const t = ev.event_type.toLowerCase();

  if (t.startsWith("kyc_link.") || t.startsWith("customer.kyc") || t.startsWith("customer.kyb")) {
    return await handleBridgeKycKyb(ev);
  }
  if (t.startsWith("virtual_account.")) {
    return await handleBridgeVirtualAccount(ev);
  }
  if (t.startsWith("wallet.")) {
    return await handleBridgeWallet(ev);
  }
  if (t.startsWith("transfer.") || t.startsWith("payout.") || t.startsWith("deposit.")) {
    return await handleBridgeTransfer(ev);
  }
  if (t.startsWith("customer.")) {
    return await handleBridgeCustomerStatus(ev);
  }

  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  { source: "bridge", unknown_event_type: t },
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

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: isKyb ? "kyc_link" : "customer", target_entity_id: String(customer) })
    .eq("event_id", ev.event_id);

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
      updated_at:            new Date().toISOString(),
    };
    if (canonicalKyc) update.kyc_status = canonicalKyc;

    await supabase.from("user_profiles")
      .update(update)
      .eq("bridge_customer_id", String(customer));
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
const CURRENCY_SCALE: Record<string, number> = { USD: 2, EUR: 2, GBP: 2 };

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

async function handleBridgeVirtualAccount(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the virtual_account; event_object_id its id.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const vaId   = d?.virtual_account_id ?? d?.id ?? ev.payload?.event_object_id;
  const customer = d?.customer_id ?? d?.customer?.id;
  if (!vaId || !customer) throw new Error("bridge virtual_account event missing ids");

  const t = ev.event_type.toLowerCase();
  const isActivity = t.includes("activity") || t.includes("deposit") || t.includes("credit");
  const currency   = String(d?.currency ?? "USD").toUpperCase();

  // Lifecycle event (created/updated/etc): upsert the bridge_virtual_accounts row.
  if (!isActivity) {
    const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(customer);
    await supabase.from("bridge_virtual_accounts").upsert({
      bridge_virtual_account_id: String(vaId),
      bridge_customer_id:        String(customer),
      user_id:                   account_type === "individual" ? resolved : null,
      business_user_id:          account_type === "business"   ? resolved : null,
      currency:                  currency,
      rail:                      d?.rail ?? d?.payment_rail ?? null,
      account_details:           d?.source_deposit_instructions ?? d?.account_details ?? {},
      status:                    String(d?.status ?? "active").toLowerCase(),
      updated_at:                new Date().toISOString(),
    }, { onConflict: "bridge_virtual_account_id" });

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

  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(customer);

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
  const walletId = d?.wallet_id ?? d?.id ?? ev.payload?.event_object_id;
  const customer = d?.customer_id ?? d?.customer?.id;
  if (!walletId || !customer) throw new Error("bridge wallet event missing ids");

  const { resolved, account_type } = await resolveOwnerFromBridgeCustomer(customer);
  await supabase.from("bridge_wallets").upsert({
    bridge_wallet_id:    String(walletId),
    bridge_customer_id:  String(customer),
    user_id:             account_type === "individual" ? resolved : null,
    business_user_id:     account_type === "business"   ? resolved : null,
    currency:            String(d?.currency ?? "usdc").toLowerCase(),
    chain:               String(d?.chain ?? "base").toLowerCase(),
    address:             String(d?.address ?? d?.deposit_address ?? ""),
    status:              String(d?.status ?? "active").toLowerCase(),
    updated_at:          new Date().toISOString(),
  }, { onConflict: "bridge_wallet_id" });

  await supabase.from("bridge_webhook_events")
    .update({ target_entity_type: "wallet", target_entity_id: String(walletId) })
    .eq("event_id", ev.event_id);
  await supabase.rpc("complete_pending_event", {
    p_event_id: ev.event_id,
    p_summary:  { source: "bridge", kind: "wallet", wallet_id: walletId },
  });
}

async function handleBridgeTransfer(ev: PendingEvent): Promise<void> {
  // Bridge envelope: event_object is the transfer; event_object_id its id.
  const d: any = ev.payload?.event_object ?? ev.payload?.data ?? ev.payload;
  const transferId = d?.transfer_id ?? d?.id ?? ev.payload?.event_object_id;
  const customer   = d?.customer_id ?? d?.customer?.id ?? d?.source?.customer_id ?? d?.destination?.customer_id;
  if (!transferId) throw new Error("bridge transfer event missing id");

  const state = String(d?.state ?? d?.status ?? "pending").toLowerCase();
  const validStates = ["pending","processing","succeeded","failed","cancelled","refunded","returned"];
  const normalizedState = validStates.includes(state) ? state : "pending";

  // Map Bridge transfer state → public.transaction_status enum.
  //   succeeded                       → completed
  //   failed | cancelled | returned   → failed
  //   else (pending|processing|refunded|unknown) → pending
  const txStatus =
    normalizedState === "succeeded"                                       ? "completed"
    : ["failed","cancelled","returned"].includes(normalizedState)         ? "failed"
    :                                                                       "pending";

  let owner: { resolved: string | null; account_type: "individual" | "business" | null } = { resolved: null, account_type: null };
  if (customer) {
    try { owner = await resolveOwnerFromBridgeCustomer(customer); } catch { /* best effort */ }
  }

  const sourceType = String(d?.source?.type ?? d?.source?.payment_rail ?? "external_bank");
  const destType   = String(d?.destination?.type ?? d?.destination?.payment_rail ?? "external_bank");
  const normSource = ["virtual_account","wallet","external_bank","external_wallet"].includes(sourceType) ? sourceType : "external_bank";
  const normDest   = ["virtual_account","wallet","external_bank","external_wallet"].includes(destType)   ? destType   : "external_bank";

  const amount   = Number(d?.amount ?? 0);
  const currency = String(d?.currency ?? d?.source?.currency ?? "USD").toUpperCase();

  // 1. Bridge-native row: full provider truth.
  await supabase.from("bridge_transfers").upsert({
    bridge_transfer_id:   String(transferId),
    user_id:              owner.account_type === "individual" ? owner.resolved : null,
    business_user_id:     owner.account_type === "business"   ? owner.resolved : null,
    source_type:          normSource,
    destination_type:     normDest,
    amount:               amount,
    currency:             currency,
    state:                normalizedState,
    raw:                  d,
    updated_at:           new Date().toISOString(),
  }, { onConflict: "bridge_transfer_id" });

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
      p_status:             txStatus,
      p_metadata: {
        source:           "bridge",
        account_type:     owner.account_type,
        source_type:      normSource,
        destination_type: normDest,
        bridge_state:     normalizedState,
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
    p_summary:  { source: "bridge", kind: "transfer", transfer_id: transferId, state: normalizedState },
  });
}

async function resolveOwnerFromBridgeCustomer(bridgeCustomerId: string): Promise<{ resolved: string; account_type: "individual" | "business" }> {
  const { data: biz } = await supabase
    .from("business_profiles")
    .select("user_id")
    .eq("bridge_customer_id", String(bridgeCustomerId))
    .maybeSingle();
  if (biz?.user_id) return { resolved: biz.user_id as string, account_type: "business" };

  const { data: prof } = await supabase
    .from("user_profiles")
    .select("id, account_type")
    .eq("bridge_customer_id", String(bridgeCustomerId))
    .maybeSingle();
  if (prof?.id) return { resolved: prof.id as string, account_type: (prof.account_type as any) === "business" ? "business" : "individual" };

  throw new Error(`no profile row for bridge_customer_id=${bridgeCustomerId}`);
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
    const { data: claimed, error } = await supabase
      .from("pending_events")
      .update({
        status:     "processing",
        locked_by:  WORKER_ID,
        locked_at:  new Date().toISOString(),
        attempts:   1,
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", eventId)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    }
    if (!claimed) {
      // Already picked up by another worker — fine.
      return new Response(JSON.stringify({ ok: true, note: "not-claimable" }), { status: 200 });
    }
    const r = await processOne(claimed as PendingEvent);
    return new Response(JSON.stringify({ ok: r.ok, error: r.error, event_id: eventId }), { status: 200 });
  }

  // Path 2: drain mode (pg_cron / manual ops).
  const batch = Math.min(Number(body?.batch_size ?? 25), 100);
  const result = await drain(batch);
  return new Response(JSON.stringify({ ok: true, worker: WORKER_ID, ...result }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
