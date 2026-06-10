// flutterwave-webhook — settle activation payments (Phase A).
//
// Flutterwave POSTs here on payment events with a `verif-hash` header equal to
// the dashboard "Secret hash" (FLUTTERWAVE_WEBHOOK_HASH). We:
//   1. Verify the signature (else 401).
//   2. Independently verify the transaction via the Flutterwave API (status +
//      amount) — never trust the webhook body's amount/status alone.
//   3. Idempotently activate the subscription via activate_subscription_external.
//   4. Best-effort send the payment-received + verify-your-ID email (recipient
//      from DB, never from the payload).
//
// verify_jwt = false (config.toml) — this is a public, signature-verified
// endpoint. Always 200 on a valid signature so Flutterwave stops retrying.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyWebhookSignature, verifyTransaction } from "../_shared/providers/flutterwave.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL = (Deno.env.get("FLW_REDIRECT_URL") || "https://app.borderpayafrica.com").trim();

const supa = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ok  = (b: unknown = { received: true }) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const bad = (s: number) => new Response(JSON.stringify({ ok: false }), { status: s, headers: { "Content-Type": "application/json" } });

async function emailPaymentReceived(userId: string, isBusiness: boolean): Promise<void> {
  if (!SEND_EMAIL_TOKEN) return;
  try {
    const { data: prof } = await supa
      .from("user_profiles")
      .select("email, full_name, company_name")
      .eq("id", userId)
      .maybeSingle();
    const to = prof?.email;
    if (!to) return;
    // Automatic-KYC model: the link points at the in-app Verify-your-ID screen
    // (no partner link generated server-side here).
    const kyc_url = `${APP_URL}/?screen=kyc`;
    const template = isBusiness ? "business.payment_received" : "individual.payment_received";
    const props = isBusiness
      ? { company_name: prof?.company_name || "your business", kyc_url }
      : { full_name: prof?.full_name || "there", kyc_url };
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, template, props, user_id: userId, idempotency_key: `activation:paid:${userId}` }),
    });
  } catch { /* best-effort — email must never fail the webhook */ }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return bad(405);

  // 1. Signature.
  if (!verifyWebhookSignature(req.headers.get("verif-hash"))) return bad(401);

  let body: any;
  try { body = await req.json(); } catch { return ok(); }   // 200 so it isn't retried forever

  const event = String(body?.event || "");
  const d = body?.data ?? {};
  if (event !== "charge.completed") return ok();             // ignore non-charge events

  const flwId = d?.id;
  if (!flwId) return ok();

  // 2. Independent verification (source of truth) — never trust the body alone.
  const v = await verifyTransaction(flwId);
  if (!v.ok || v.status.toLowerCase() !== "successful" || !v.tx_ref) return ok();

  // 3. Idempotent activate.
  const { data: result } = await supa.rpc("activate_subscription_external", {
    p_tx_ref:       v.tx_ref,
    p_flw_tx_id:    v.flw_id,
    p_amount_minor: Math.round(v.amount * 100),
    p_currency:     v.currency,
  });

  // 4. Email only on a fresh activation (not on idempotent replays).
  const r: any = result;
  if (r?.success === true && r?.already !== true && r?.user_id) {
    await emailPaymentReceived(String(r.user_id), !!r.is_business);
  }

  return ok();
});
