// subscription-upgrade — debit user's USD virtual account, switch plan.
//
// POST body:
//   {
//     plan_key:        'individual_activated' | 'business_activated',  (one-time)
//     bridge_va_id:    string   // bridge_virtual_account_id of the USD VA to charge
//   }
//
// Response: { success, data: { invoice_id, subscription_id, plan_key,
//   period_start, period_end, amount_usd_cents, new_balance_minor } }
//
// Flow:
//   1. Authenticate the caller via supabase.auth.getUser(token).
//   2. Load the caller's user_profiles row to determine account_type.
//   3. Look up the active subscription row (individual or business).
//   4. Validate plan_key — only paid plans on the matching account_type are
//      acceptable. Enterprise is contact-sales only and rejected here.
//   5. Compute amount in USD cents from the plan definition (server-side
//      authority — never trust client-supplied prices).
//   6. Call create_subscription_invoice (RPC) to materialise the pending invoice.
//   7. Call pay_subscription_invoice_from_va (RPC) which performs the debit,
//      ledger insert, transactions mirror, invoice paid, subscription
//      activation — all in one transaction.
//   8. Switch the user_subscriptions row's plan_key to plan_key.
//   9. Return the result.
//
// Error codes surfaced to the client:
//   • 400 invalid_plan
//   • 400 missing_va
//   • 401 unauthorized
//   • 402 insufficient_funds            — INSUFFICIENT_FUNDS exception
//   • 403 country_not_supported         — DRC / Bridge-prohibited
//   • 409 no_active_subscription
//   • 409 plan_account_type_mismatch
//   • 409 cannot_downgrade_with_balance — currently unused, reserved
//   • 502 billing_failed                — any unexpected RPC error

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// One-time activation fee catalogue (server-side authority). Mirrors
// utils/subscriptions/plans.ts; keep in sync if you change either. These are
// ONE-TIME activation fees, not recurring subscriptions.
const PLAN_PRICES_CENTS: Record<string, number> = {
  individual_activated: 999,
  business_activated:   2999,
};
const PLAN_ACCOUNT_TYPE: Record<string, "individual" | "business"> = {
  individual_activated: "individual",
  business_activated:   "business",
};

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Post-payment verification email ───────────────────────────────────────
// After a successful activation payment we email the user a SECURE HOSTED
// verification link (Bridge /v0/kyc_links). The in-app KYC screen is read-only
// status, so the link is delivered by email. This whole path is BEST-EFFORT:
// it never blocks or fails the activation response (the money already moved).
const BRIDGE_BASE_URL  = (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz").replace(/\/+$/, "");
const BRIDGE_API_KEY   = Deno.env.get("BRIDGE_API_KEY") ?? "";
const APP_URL          = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";

function extractKycLink(parsed: any): { link_url: string; link_id: string; customer_id?: string } | null {
  if (!parsed) return null;
  const candidates = [parsed?.data, parsed, parsed?.existing_kyc_link].filter(Boolean);
  for (const c of candidates) {
    const link_url: string | null =
      c?.kyc_link?.url || (typeof c?.kyc_link === "string" ? c.kyc_link : null) || c?.url || c?.link;
    const link_id: string | null = c?.kyc_link?.id || c?.id;
    const customer_id: string | undefined = c?.customer_id || c?.kyc_link?.customer_id;
    if (link_url && link_id) return { link_url, link_id, customer_id };
  }
  return null;
}

async function bridgeKycPost(body: unknown, idemKey: string): Promise<any> {
  if (!BRIDGE_API_KEY) return null;
  const res = await fetch(`${BRIDGE_BASE_URL}/v0/kyc_links`, {
    method: "POST",
    headers: {
      "Api-Key": BRIDGE_API_KEY, "Accept": "application/json", "Content-Type": "application/json",
      "Idempotency-Key": idemKey, "User-Agent": "borderpay-edge/1.0",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function postSendEmail(userId: string, to: string, template: string, props: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SEND_EMAIL_TOKEN}` },
    body: JSON.stringify({ to, template, props, user_id: userId, idempotency_key: `activation:verify:${userId}` }),
  });
}

/** Best-effort: ensure a hosted verification link exists, then email it. Never throws. */
async function emailVerificationLink(userId: string, accountType: "individual" | "business"): Promise<void> {
  try {
    if (!BRIDGE_API_KEY || !SEND_EMAIL_TOKEN) return;

    if (accountType === "business") {
      const { data: prof } = await supa.from("user_profiles").select("email").eq("id", userId).maybeSingle();
      const { data: biz } = await supa.from("business_profiles")
        .select("company_name, bridge_customer_id, bridge_kyb_status, bridge_kyb_link_id, bridge_kyb_link_url")
        .eq("user_id", userId).maybeSingle();
      const email = prof?.email;
      if (!email || !biz?.company_name) return;
      if ((biz.bridge_kyb_status || "").toLowerCase() === "approved") return;
      let link_url = biz.bridge_kyb_link_url as string | null;
      if (!link_url) {
        const reqBody: Record<string, unknown> = {
          type: "business", email, business_legal_name: biz.company_name,
          endorsements: ["base"], redirect_uri: `${APP_URL}/onboarding/kyc-complete`,
        };
        if (biz.bridge_customer_id) reqBody.customer_id = biz.bridge_customer_id;
        const link = extractKycLink(await bridgeKycPost(reqBody, `borderpay:kyb:business:${biz.bridge_customer_id || userId}`));
        if (!link) return;
        link_url = link.link_url;
        await supa.from("business_profiles").update({
          bridge_kyb_link_id: link.link_id, bridge_kyb_link_url: link.link_url,
          ...(link.customer_id ? { bridge_customer_id: link.customer_id } : {}), updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
      }
      await postSendEmail(userId, email, "business.payment_received", { company_name: biz.company_name, kyc_url: link_url });
      return;
    }

    const { data: prof } = await supa.from("user_profiles")
      .select("email, full_name, bridge_customer_id, bridge_kyc_status, bridge_kyc_link_id, bridge_kyc_link_url")
      .eq("id", userId).maybeSingle();
    if (!prof?.email) return;
    if ((prof.bridge_kyc_status || "").toLowerCase() === "approved") return;
    let link_url = prof.bridge_kyc_link_url as string | null;
    if (!link_url) {
      const reqBody: Record<string, unknown> = {
        type: "individual", email: prof.email, full_name: prof.full_name || "User",
        endorsements: ["base"], redirect_uri: `${APP_URL}/onboarding/kyc-complete`,
      };
      if (prof.bridge_customer_id) reqBody.customer_id = prof.bridge_customer_id;
      const link = extractKycLink(await bridgeKycPost(reqBody, `borderpay:kyc:individual:${prof.bridge_customer_id || userId}`));
      if (!link) return;
      link_url = link.link_url;
      await supa.from("user_profiles").update({
        bridge_kyc_link_id: link.link_id, bridge_kyc_link_url: link.link_url,
        ...(link.customer_id ? { bridge_customer_id: link.customer_id } : {}), updated_at: new Date().toISOString(),
      }).eq("id", userId);
    }
    await postSendEmail(userId, prof.email, "individual.payment_received", { full_name: prof.full_name, kyc_url: link_url });
  } catch (e) {
    console.error("emailVerificationLink (best-effort) failed:", (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required", code: "unauthorized" }, 401);

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized", code: "unauthorized" }, 401);

  let body: { plan_key?: string; bridge_va_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const planKey = String(body.plan_key || "");
  const vaId    = String(body.bridge_va_id || "");
  if (!PLAN_PRICES_CENTS[planKey]) {
    return json({ success: false, error: `Unknown or non-payable plan: ${planKey}`, code: "invalid_plan" }, 400);
  }
  if (!vaId) {
    return json({ success: false, error: "bridge_va_id is required", code: "missing_va" }, 400);
  }

  const expectedAccountType = PLAN_ACCOUNT_TYPE[planKey];

  // Profile + active subscription row.
  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, account_type")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);
  if (profile.account_type !== expectedAccountType) {
    return json({
      success: false,
      code:    "plan_account_type_mismatch",
      error:   `Plan ${planKey} is for ${expectedAccountType} accounts; this account is ${profile.account_type}.`,
    }, 409);
  }

  const subQuery = supa
    .from("user_subscriptions")
    .select("id, plan_key, status")
    .in("status", ["active", "trialing", "past_due", "incomplete"]);
  const { data: sub } = profile.account_type === "business"
    ? await subQuery.eq("business_user_id", user.id).maybeSingle()
    : await subQuery.eq("user_id", user.id).maybeSingle();
  if (!sub?.id) {
    return json({ success: false, error: "No active subscription row. Please contact support.", code: "no_active_subscription" }, 409);
  }

  const amountCents = PLAN_PRICES_CENTS[planKey];

  // 1. Create the invoice.
  const { data: invoiceId, error: invoiceErr } = await supa.rpc("create_subscription_invoice", {
    p_subscription_id:   sub.id,
    p_plan_key:          planKey,
    p_amount_usd_cents:  amountCents,
  });
  if (invoiceErr || !invoiceId) {
    return json({ success: false, error: `Invoice creation failed: ${invoiceErr?.message}`, code: "billing_failed" }, 502);
  }

  // 2. Charge from the user's USD VA. RPC enforces ownership + funds.
  const { data: payResult, error: payErr } = await supa.rpc("pay_subscription_invoice_from_va", {
    p_invoice_id:    invoiceId,
    p_owner_user_id: user.id,
    p_bridge_va_id:  vaId,
  });
  if (payErr) {
    // Map known SQL error codes to clean HTTP codes.
    const msg = payErr.message || "";
    if (msg.includes("INSUFFICIENT_FUNDS")) {
      return json({ success: false, code: "insufficient_funds", error: "Not enough balance in the selected USD virtual account." }, 402);
    }
    if (msg.includes("OWNERSHIP_MISMATCH")) {
      return json({ success: false, code: "ownership_mismatch", error: "The selected virtual account does not belong to this account." }, 403);
    }
    if (msg.includes("CURRENCY_MISMATCH")) {
      return json({ success: false, code: "currency_mismatch", error: "Subscription must be paid from a USD virtual account." }, 400);
    }
    if (msg.includes("INVOICE_NOT_PENDING")) {
      return json({ success: false, code: "invoice_not_pending", error: "This invoice has already been processed." }, 409);
    }
    return json({ success: false, error: `Billing failed: ${msg}`, code: "billing_failed" }, 502);
  }

  // 3. Switch the plan_key on the subscription row.
  await supa.rpc("switch_subscription_plan", {
    p_subscription_id: sub.id,
    p_new_plan_key:    planKey,
  });

  // 4. Best-effort: email the hosted verification link now that payment
  //    succeeded. Wrapped so it can never fail the activation response.
  await emailVerificationLink(user.id, profile.account_type as "individual" | "business");

  return json({
    success: true,
    data: {
      invoice_id:        invoiceId,
      subscription_id:   sub.id,
      previous_plan_key: sub.plan_key,
      plan_key:          planKey,
      period_start:      (payResult as any)?.period_start,
      period_end:        (payResult as any)?.period_end,
      amount_usd_cents:  amountCents,
      new_balance_minor: (payResult as any)?.new_balance_minor,
    },
  });
});
