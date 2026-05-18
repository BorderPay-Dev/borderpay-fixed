// bridge-transfer v2 — strict client-controlled idempotency for money movement.
//
// POST body:
//   {
//     source:         { payment_rail, currency, chain?, amount },  // amount = decimal string
//     destination:    { payment_rail, currency, chain?, address?, bank_account? },
//     developer_fee?: { percentage?, flat_amount? },
//     idempotency_key: string   // REQUIRED. Client-provided.
//   }
//
// Money-movement idempotency policy (per CTO review):
//
//   The earlier version generated a fresh `crypto.randomUUID()` per
//   request. That defeats Bridge's `Idempotency-Key` header — a network
//   retry from the client created a SECOND Bridge transfer for the same
//   user intent. Real money. Unacceptable.
//
//   v2 requires the client to supply a stable `idempotency_key` in the
//   request body. The client is expected to:
//     • Generate one key per user *intent* (e.g. one Confirm tap on the
//       Send screen) — typically a UUIDv4 stored in form state.
//     • Re-send the same key on retries / timeouts / "Confirm" double-
//       taps for the same transfer.
//
//   Acceptable formats: any non-empty string up to 128 chars. We
//   canonicalise to `borderpay:transfer:<user.id>:<client_key>` so the
//   namespace can't collide across users even if two users happened to
//   pick the same key.
//
//   If the body is missing `idempotency_key`, we refuse with 400
//   `idempotency_key_required`. Fail closed.
//
//   Additionally we add a DB pre-check: if `transactions` already has a
//   row with the same `metadata->>idempotency_key` for this user, we
//   return the existing transfer_id without calling Bridge again. This
//   guards against the case where Bridge accepted on the first call but
//   we crashed before responding to the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { AFRICAN_RAMP_CURRENCIES } from "../_shared/providers/african-onramp.types.ts";
import { isBridgeProhibited, bridgeCountryBlockResponse } from "../_shared/providers/bridge-country-policy.ts";

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

/** Strict idempotency-key validation: non-empty string, ≤128 chars,
 *  printable ASCII only (no surprises across header / DB serialization). */
function isValidIdempotencyKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length < 8 || v.length > 128) return false;
  return /^[\x21-\x7E]+$/.test(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  if (!body?.source?.amount || !body?.source?.currency || !body?.destination?.currency) {
    return json({ success: false, error: "source.amount, source.currency, destination.currency required" }, 400);
  }
  if (!isValidIdempotencyKey(body?.idempotency_key)) {
    return json({
      success: false,
      code:    "idempotency_key_required",
      error:   "A client-provided idempotency_key (8-128 printable ASCII chars) is required for transfers.",
    }, 400);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("country, bridge_customer_id, bridge_kyc_status, payment_provider")
    .eq("id", user.id)
    .maybeSingle();
  if (isBridgeProhibited(profile?.country)) {
    return json(bridgeCountryBlockResponse(profile!.country!), 403);
  }
  if (!profile?.bridge_customer_id) {
    return json({ success: false, error: "Bridge customer required first", code: "no_customer" }, 409);
  }
  if (profile.bridge_kyc_status !== "approved") {
    return json({ success: false, error: "KYC not approved yet", code: "kyc_not_approved" }, 409);
  }

  const destCurrency = String(body.destination.currency || "").toUpperCase();
  if ((AFRICAN_RAMP_CURRENCIES as readonly string[]).includes(destCurrency)) {
    return json({
      success: false,
      code:   "no_partner",
      error:  `${destCurrency} payouts (mobile money / local bank) are coming soon. Your African on/off-ramp partner is not yet integrated.`,
    }, 503);
  }

  // Canonicalise: include user.id so two users can't collide on the same key.
  const clientKey = body.idempotency_key as string;
  const idem      = `borderpay:transfer:${user.id}:${clientKey}`;

  // DB pre-check: if we already have a transactions row for this idempotency
  // key, return the previous transfer_id without touching Bridge. Guards
  // against retries where we crashed between Bridge accept and our DB write.
  {
    const { data: existing } = await supa
      .from("transactions")
      .select("bridge_transfer_id, status")
      .eq("user_id", user.id)
      .eq("metadata->>idempotency_key", idem)
      .maybeSingle();
    if (existing?.bridge_transfer_id) {
      return json({
        success: true,
        data: {
          transfer_id: existing.bridge_transfer_id,
          state:       existing.status === "completed" ? "succeeded"
                      : existing.status === "failed"   ? "failed"
                      :                                  "pending",
          replayed:    true,
        },
      });
    }
  }

  try {
    const result = await bridgeProvider.createTransfer({
      source: {
        customer_id:  profile.bridge_customer_id,
        payment_rail: body.source.payment_rail || "stablecoin",
        currency:     body.source.currency,
        chain:        body.source.chain,
        amount:       String(body.source.amount),
      },
      destination:     body.destination,
      developer_fee:   body.developer_fee,
      // Pass the same canonical key to Bridge so Bridge's own idempotency
      // store dedupes retries too. The shared bridge-client forwards this
      // as the HTTP `Idempotency-Key` header.
      idempotency_key: idem,
    });

    // Persist the transaction row. We use ON CONFLICT (bridge_transfer_id)
    // via upsert so a retry that races our DB write doesn't duplicate.
    await supa.from("transactions").upsert(
      {
        user_id:            user.id,
        type:               body.source.payment_rail === "stablecoin" ? "stablecoin_transfer" : "transfer",
        amount:             body.source.amount,
        currency:           body.source.currency,
        status:             result.state === "succeeded" ? "completed" : (result.state === "failed" ? "failed" : "pending"),
        reference:          result.transfer_id,
        bridge_transfer_id: result.transfer_id,
        provider:           "bridge",
        metadata:           { idempotency_key: idem, raw: result.raw },
        created_at:         new Date().toISOString(),
      },
      { onConflict: "bridge_transfer_id" },
    );

    return json({ success: true, data: { transfer_id: result.transfer_id, state: result.state } });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
