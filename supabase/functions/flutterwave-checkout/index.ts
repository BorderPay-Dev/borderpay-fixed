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

// Charge CURRENCY + per-plan AMOUNT are env-configurable. Default USD, but set
// FLW_ACTIVATION_CURRENCY=NGN (and the NGN amounts) so CARD + bank transfer +
// USSD + mobile money show — USD on a Nigerian account often only offers Apple
// Pay. Amounts are MAJOR units of the chosen currency (e.g. 16000 = ₦16,000).
const CURRENCY = (Deno.env.get("FLW_ACTIVATION_CURRENCY") || "USD").trim().toUpperCase();
const FEE_MAJOR: Record<string, number> = {
  individual_activated: Number(Deno.env.get("FLW_FEE_INDIVIDUAL") || "9.99"),
  business_activated:   Number(Deno.env.get("FLW_FEE_BUSINESS")   || "29.99"),
};

const APP_URL = (Deno.env.get("FLW_REDIRECT_URL") || "https://app.borderpayafrica.com").trim();

// Methods to show on the hosted page. Default explicitly requests CARD —
// without payment_options the provider picks its own defaults (which surfaced
// only one wallet method on this account). Comma-separated, env-overridable
// (e.g. "card,banktransfer,ussd,mobilemoney").
const PAYMENT_OPTIONS = (Deno.env.get("FLW_PAYMENT_OPTIONS") || "card").trim();

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
  const amountMajor = FEE_MAJOR[planKey];
  const amountMinor = Math.round(amountMajor * 100);   // minor units of CURRENCY
  const email = profile?.email || user.email;
  if (!email) return json({ success: false, error: "No email on file" }, 400);

  const txRef = `bpactv:${user.id}:${crypto.randomUUID()}`;

  const { error: insErr } = await supa.from("activation_payments").insert({
    user_id:      user.id,
    is_business:  isBusiness,
    plan_key:     planKey,
    tx_ref:       txRef,
    amount_minor: amountMinor,
    currency:     CURRENCY,
    status:       "pending",
  });
  if (insErr) return json({ success: false, error: "Could not start activation. Please try again." }, 500);

  const pay = await createPayment({
    tx_ref:       txRef,
    amount:       amountMajor,
    currency:     CURRENCY,
    payment_options: PAYMENT_OPTIONS,
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
