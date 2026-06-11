// flutterwave-checkout — start an activation-fee payment (Phase A).
//
// POST {} (plan inferred from account_type). Records a 'pending'
// activation_payments row and returns the HOSTED checkout URL. Hosted shows
// every payment method enabled on the account (card, bank transfer, USSD, mobile money, …) — inline with USDonly surfaced a couple of methods.
//
// verify_jwt = true. Requires FLUTTERWAVE_SECRET_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createPayment, flutterwaveConfigured } from "../_shared/providers/flutterwave.ts";

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

const FEE_MINOR: Record<string, number> = {
  individual_activated: 999,
  business_activated:   2999,
};

const APP_URL = (Deno.env.get("FLW_REDIRECT_URL") || "https://app.borderpayafrica.com").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  if (!flutterwaveConfigured()) {
    return json({ success: false, code: "gateway_unavailable", error: "Activation is temporarily unavailable. Please try again later." }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: profile } = await supa
    .from("user_profiles")
    .select("account_type, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const isBusiness = profile?.account_type === "business";
  const planKey    = isBusiness ? "business_activated" : "individual_activated";
  const amountMinor = FEE_MINOR[planKey];
  const email = profile?.email || user.email;
  if (!email) return json({ success: false, error: "No email on file" }, 400);

  const txRef = `bpactv:${user.id}:${crypto.randomUUID()}`;

  const { error: insErr } = await supa.from("activation_payments").insert({
    user_id:      user.id,
    is_business:  isBusiness,
    plan_key:     planKey,
    tx_ref:       txRef,
    amount_minor: amountMinor,
    currency:     "USD",
    status:       "pending",
  });
  if (insErr) return json({ success: false, error: "Could not start activation. Please try again." }, 500);

  const pay = await createPayment({
    tx_ref:       txRef,
    amount:       amountMinor / 100,
    currency:     "USD",
    redirect_url: `${APP_URL}/?activation=return`,
    customer:     { email, name: profile?.full_name || undefined },
    title:        "BorderPay",
    meta:         { user_id: user.id, plan_key: planKey },
  });
  if (!pay.ok) {
    return json({ success: false, code: "checkout_failed", error: "Could not start activation. Please try again." }, 502);
  }

  return json({ success: true, data: { checkout_url: pay.link, tx_ref: txRef } });
});
