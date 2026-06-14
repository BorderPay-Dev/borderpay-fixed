// bridge-bulk-payout v1 — batch payouts (payroll / supplier / contractor /
// marketplace / creator) over the SAME validated single-transfer rail.
//
// This does NOT invent a new money path. It runs the identical gates and the
// identical `bridgeProvider.createTransfer` + `upsert_bridge_transaction` that
// `bridge-transfer` uses, once PER recipient, sequentially, collecting a
// per-item result. One bad row never aborts the batch and never double-pays a
// good row (each item carries its own idempotency key).
//
// POST body:
//   {
//     source_currency: "USDC",                  // currency debited for every item
//     items: [
//       {
//         destination: { payment_rail, currency, chain?, address?, bank_account? },
//         amount:          "100.00",            // decimal string, per recipient
//         idempotency_key: string,              // REQUIRED, unique per recipient intent
//         label?:          string               // optional payee label (memo only)
//       }, ...
//     ]
//   }
//
// Server gate `BRIDGE_TRANSFERS_ENABLED="true"` is required (same as transfers).
// developer_fee is enforced server-side; never taken from the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { bridgeDeveloperFeePercent } from "../_shared/fees/schedule.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { requireActivatedPlan } from "../_shared/plan-gate.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MAX_ITEMS = 250;   // batch cap — keeps the function within its time budget

function isValidIdempotencyKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length < 8 || v.length > 128) return false;
  return /^[\x21-\x7E]+$/.test(v);
}
function transfersEnabled(): boolean {
  return (Deno.env.get("BRIDGE_TRANSFERS_ENABLED") || "").toLowerCase() === "true";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  // Hard gate — fail closed before any auth/Bridge side effects.
  if (!transfersEnabled()) {
    return json({ success: false, code: "transfer_not_enabled",
      error: "Money movement is not enabled in this environment yet." }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const sourceCurrency = body?.source_currency;
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!sourceCurrency || items.length === 0) {
    return json({ success: false, error: "source_currency and a non-empty items[] are required" }, 400);
  }
  if (items.length > MAX_ITEMS) {
    return json({ success: false, code: "batch_too_large",
      error: `Batch exceeds ${MAX_ITEMS} recipients. Split into smaller batches.` }, 400);
  }

  // Validate EVERY item up front — reject the whole batch on a malformed row so
  // the operator fixes the file rather than discovering bad rows mid-run.
  const seenKeys = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it?.amount || !it?.destination?.currency) {
      return json({ success: false, error: `Row ${i + 1}: amount and destination.currency are required` }, 400);
    }
    if (!(Number(it.amount) > 0)) {
      return json({ success: false, error: `Row ${i + 1}: amount must be greater than 0` }, 400);
    }
    if (!isValidIdempotencyKey(it.idempotency_key)) {
      return json({ success: false, error: `Row ${i + 1}: a unique idempotency_key (8-128 printable ASCII) is required` }, 400);
    }
    if (seenKeys.has(it.idempotency_key)) {
      return json({ success: false, error: `Row ${i + 1}: duplicate idempotency_key in batch` }, 400);
    }
    seenKeys.add(it.idempotency_key);
  }

  // Account-level gates — checked ONCE for the whole batch (same as a single send).
  const { data: profile } = await supa
    .from("user_profiles")
    .select("account_type, country, bridge_customer_id, bridge_kyc_status, maintenance_overdue")
    .eq("id", user.id)
    .maybeSingle();

  if (isBridgeBlocked(profile?.country)) return json(bridgeCountryBlockResponse(profile!.country!), 403);
  if (profile?.maintenance_overdue === true) {
    return json({ success: false, code: "maintenance_due",
      error: "Clear your account maintenance fee before sending. Outbound transfers are paused until then." }, 402);
  }
  logControlledBridgeTraffic("bridge-bulk-payout", profile?.country, user.id);
  if (!profile?.bridge_customer_id) return json({ success: false, code: "no_customer", error: "Bridge customer required first" }, 409);
  if (profile.bridge_kyc_status !== "approved") return json({ success: false, code: "kyc_not_approved", error: "KYC not approved yet" }, 409);
  {
    const isBusiness = profile?.account_type === "business";
    const gate = await requireActivatedPlan(supa, user.id, isBusiness);
    if (!gate.allowed) return json(gate.body, gate.status);
  }

  // Process each recipient sequentially. A per-item failure is recorded and the
  // batch continues — it never aborts the run or retries a succeeded row.
  const results: any[] = [];
  let submitted = 0, failed = 0, totalAmount = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = i + 1;
    const idem = `borderpay:bulk:${user.id}:${it.idempotency_key}`;

    try {
      // Idempotent replay guard — if we already created this item, reuse it.
      const { data: existing } = await supa
        .from("transactions")
        .select("bridge_transfer_id, status")
        .eq("user_id", user.id)
        .eq("metadata->>idempotency_key", idem)
        .maybeSingle();
      if (existing?.bridge_transfer_id) {
        results.push({ row, label: it.label ?? null, transfer_id: existing.bridge_transfer_id,
          state: existing.status === "completed" ? "succeeded" : existing.status === "failed" ? "failed" : "pending",
          replayed: true });
        submitted++; totalAmount += Number(it.amount) || 0;
        continue;
      }

      const sourceRail    = it.source_payment_rail || "stablecoin";
      const devFeePercent = bridgeDeveloperFeePercent(sourceRail, sourceCurrency);

      const result = await bridgeProvider.createTransfer({
        source: {
          customer_id:  profile.bridge_customer_id,
          payment_rail: sourceRail,
          currency:     sourceCurrency,
          chain:        it.source_chain,
          amount:       String(it.amount),
        },
        destination:     it.destination,
        developer_fee:   { percentage: devFeePercent },
        idempotency_key: idem,
      });

      const dbStatus = result.state === "succeeded" ? "completed" : result.state === "failed" ? "failed" : "pending";
      const { error: upsertErr } = await supa.rpc("upsert_bridge_transaction", {
        p_user_id:            user.id,
        p_bridge_transfer_id: result.transfer_id,
        p_amount:             Number(it.amount),
        p_currency:           sourceCurrency,
        p_status:             dbStatus,
        p_metadata:           { idempotency_key: idem, bulk: true, label: it.label ?? null, raw: result.raw },
        p_description:        it.label ? `Bulk payout — ${it.label}` : "Bulk payout",
      });
      if (upsertErr) {
        results.push({ row, label: it.label ?? null, state: "persistence_failed",
          transfer_id: result.transfer_id, error: upsertErr.message });
        failed++;
        continue;
      }

      results.push({ row, label: it.label ?? null, transfer_id: result.transfer_id, state: result.state });
      submitted++; totalAmount += Number(it.amount) || 0;
    } catch (e) {
      results.push({ row, label: it.label ?? null, state: "failed", error: (e as Error).message });
      failed++;
    }
  }

  return json({
    success: true,
    data: {
      results,
      summary: { total: items.length, submitted, failed, total_amount: totalAmount, currency: sourceCurrency },
    },
  });
});
