// bridge-transfer — orchestrate stablecoin↔fiat transfers via Bridge.
//
// POST body:
//   {
//     source: { payment_rail, currency, chain?, amount }      // amount is decimal string
//     destination: { payment_rail, currency, chain?, address?, bank_account? }
//     developer_fee?: { percentage?, flat_amount? }
//   }
//
// Detects "African ramp" destinations and refuses cleanly with
//   { code: 'no_partner' } until our future on/off-ramp partner is wired.

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

  const { data: profile } = await supa
    .from("user_profiles")
    .select("country, bridge_customer_id, bridge_kyc_status, payment_provider")
    .eq("id", user.id)
    .maybeSingle();
  // Defense-in-depth: refuse Bridge transfers for users in
  // Bridge-prohibited jurisdictions before any side effect (Bridge call OR
  // transactions insert).
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

  const idem = `borderpay:transfer:${user.id}:${crypto.randomUUID().slice(0, 8)}`;

  try {
    const result = await bridgeProvider.createTransfer({
      source: {
        customer_id:  profile.bridge_customer_id,
        payment_rail: body.source.payment_rail || "stablecoin",
        currency:     body.source.currency,
        chain:        body.source.chain,
        amount:       String(body.source.amount),
      },
      destination: body.destination,
      developer_fee: body.developer_fee,
      idempotency_key: idem,
    });

    // Persist as a transaction row so the dashboard sees it immediately.
    await supa.from("transactions").insert({
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
    });

    return json({ success: true, data: { transfer_id: result.transfer_id, state: result.state } });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
