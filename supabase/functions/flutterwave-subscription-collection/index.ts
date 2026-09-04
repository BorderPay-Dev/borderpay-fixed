import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("WORKER_AUTH_TOKEN") ?? "";
const FLW_SECRET_KEY = Deno.env.get("FLUTTERWAVE_SECRET_KEY") ?? "";
const FLW_WEBHOOK_HASH = Deno.env.get("FLUTTERWAVE_WEBHOOK_HASH") ?? "";
const APP_URL = (Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com").replace(/\/+$/, "");
const FLW_API = "https://api.flutterwave.com/v3";
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function equal(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

async function flutterwave(path: string, init: RequestInit): Promise<Record<string, any>> {
  if (!FLW_SECRET_KEY) throw new Error("flutterwave_not_configured");
  const response = await fetch(`${FLW_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FLW_SECRET_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || clean(payload?.status).toLowerCase() !== "success") {
    throw new Error(`flutterwave_request_failed:${response.status}:${clean(payload?.message).slice(0, 180)}`);
  }
  return payload;
}

async function drainInvoices() {
  if (!FLW_SECRET_KEY || !FLW_WEBHOOK_HASH) {
    return { configured: false, selected: 0, created: 0, failed: 0 };
  }

  const { data: invoices, error } = await db.from("subscription_external_invoices")
    .select("id,user_id,amount,currency,billing_period,provider_reference,status,attempt_count")
    .eq("provider", "flutterwave")
    .eq("status", "pending_configuration")
    .order("created_at")
    .limit(30);
  if (error) throw error;

  let created = 0;
  let failed = 0;
  for (const invoice of invoices ?? []) {
    const txRef = clean(invoice.provider_reference) || `bp-maintenance-${invoice.id}`;
    const { data: profile, error: profileError } = await db.from("user_profiles")
      .select("email,full_name")
      .eq("id", invoice.user_id)
      .maybeSingle();
    if (profileError || !profile?.email) {
      await db.from("subscription_external_invoices").update({
        provider_reference: txRef,
        attempt_count: 1,
        last_error: "customer_email_unavailable",
        updated_at: new Date().toISOString(),
      }).eq("id", invoice.id).eq("status", "pending_configuration");
      failed++;
      continue;
    }

    // Persist the deterministic reference before the provider call so a
    // network retry cannot produce a second logical invoice.
    const { error: reserveError } = await db.from("subscription_external_invoices").update({
      provider_reference: txRef,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id).eq("status", "pending_configuration");
    if (reserveError) throw reserveError;

    try {
      const response = await flutterwave("/payments", {
        method: "POST",
        body: JSON.stringify({
          tx_ref: txRef,
          amount: Number(invoice.amount).toFixed(2),
          currency: invoice.currency,
          redirect_url: `${APP_URL}/?billing=maintenance&reference=${encodeURIComponent(txRef)}`,
          customer: {
            email: clean(profile.email).toLowerCase(),
            name: clean(profile.full_name) || "BorderPay customer",
          },
          customizations: {
            title: "BorderPay account maintenance",
            description: `Account maintenance for ${invoice.billing_period}`,
          },
          meta: { borderpay_invoice_id: invoice.id },
        }),
      });
      const paymentLink = clean(response?.data?.link);
      if (!paymentLink.startsWith("https://")) throw new Error("flutterwave_payment_link_missing");
      const { error: markError } = await db.rpc("mark_external_subscription_invoice_link", {
        p_invoice_id: invoice.id,
        p_provider_reference: txRef,
        p_payment_link: paymentLink,
        p_expires_at: null,
      });
      if (markError) throw markError;
      created++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db.from("subscription_external_invoices").update({
        attempt_count: Number(invoice.attempt_count ?? 0) + 1,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", invoice.id).eq("status", "pending_configuration");
      failed++;
    }
  }
  return { configured: true, selected: invoices?.length ?? 0, created, failed };
}

async function reconcileInvoices(providerReference?: string) {
  if (!FLW_SECRET_KEY) return { configured: false, selected: 0, reconciled: 0, pending: 0, failed: 0, results: [] };

  let query = db.from("subscription_external_invoices")
    .select("id,provider_reference,status")
    .eq("provider", "flutterwave")
    .eq("status", "payment_link_created")
    .not("provider_reference", "is", null)
    .order("created_at")
    .limit(providerReference ? 1 : 100);
  if (providerReference) query = query.eq("provider_reference", providerReference);
  const { data: invoices, error } = await query;
  if (error) throw error;

  let reconciled = 0;
  let pending = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const invoice of invoices ?? []) {
    const reference = clean(invoice.provider_reference);
    try {
      const verification = await flutterwave(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { method: "GET" });
      const verified = verification?.data ?? {};
      if (clean(verified.status).toLowerCase() !== "successful") {
        pending++;
        results.push({ invoice_id: invoice.id, provider_reference: reference, status: clean(verified.status).toLowerCase() || "not_successful" });
        continue;
      }
      const transactionId = clean(verified.id);
      if (!transactionId) throw new Error("flutterwave_verified_transaction_id_missing");
      const { data, error: completeError } = await db.rpc("complete_external_subscription_invoice", {
        p_provider_reference: reference,
        p_provider_transaction_id: transactionId,
        p_amount: Number(verified.amount),
        p_currency: clean(verified.currency).toUpperCase(),
        p_event_id: `flutterwave:reconcile:${transactionId}:charge.completed`,
      });
      if (completeError) throw completeError;
      reconciled++;
      results.push({ invoice_id: invoice.id, provider_reference: reference, status: "paid", result: data });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A failed provider lookup is not proof of payment failure. Preserve the
      // invoice for a later webhook/retry and return a bounded diagnostic.
      failed++;
      results.push({ invoice_id: invoice.id, provider_reference: reference, status: "unresolved", error: message.slice(0, 180) });
    }
  }
  return { configured: true, selected: invoices?.length ?? 0, reconciled, pending, failed, results };
}

async function handleWebhook(req: Request) {
  if (!FLW_WEBHOOK_HASH || !equal(req.headers.get("verif-hash") ?? "", FLW_WEBHOOK_HASH)) {
    return json({ success: false, error: "invalid_signature" }, 401);
  }
  if (!FLW_SECRET_KEY) return json({ success: false, error: "flutterwave_not_configured" }, 503);

  const event = await req.json().catch(() => null) as Record<string, any> | null;
  if (!event || clean(event.event).toLowerCase() !== "charge.completed") {
    return json({ success: true, ignored: true });
  }
  const transactionId = clean(event?.data?.id);
  const txRef = clean(event?.data?.tx_ref);
  if (!transactionId || !txRef.startsWith("bp-maintenance-")) {
    return json({ success: true, ignored: true });
  }

  // The webhook is only a notification. Re-read Flutterwave before changing
  // financial state and require exact reference, currency and amount in SQL.
  const verification = await flutterwave(`/transactions/${encodeURIComponent(transactionId)}/verify`, { method: "GET" });
  const verified = verification?.data ?? {};
  if (clean(verified.status).toLowerCase() !== "successful" || clean(verified.tx_ref) !== txRef) {
    return json({ success: false, error: "provider_transaction_not_successful" }, 409);
  }
  const eventId = clean(event?.id) || `flutterwave:${transactionId}:charge.completed`;
  const { data, error } = await db.rpc("complete_external_subscription_invoice", {
    p_provider_reference: txRef,
    p_provider_transaction_id: transactionId,
    p_amount: Number(verified.amount),
    p_currency: clean(verified.currency).toUpperCase(),
    p_event_id: eventId,
  });
  if (error) throw error;
  return json({ success: true, data });
}

Deno.serve(async (req) => {
  // Provider dashboards may probe the configured webhook URL before sending
  // signed events. Health probes must never read or mutate payment state.
  if (req.method === "GET") {
    return json({ success: true, service: "flutterwave-subscription-collection" });
  }
  if (req.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  try {
    if (req.headers.has("verif-hash")) return await handleWebhook(req);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const { data: configuredWorkerToken } = await db.rpc("app_config_get", { p_key: "worker_auth_token" });
    if (!(equal(token, WORKER_TOKEN) || equal(token, SERVICE_ROLE) || equal(token, clean(configuredWorkerToken)))) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const body = await req.json().catch(() => ({}));
    if (body?.mode === "reconcile") {
      const providerReference = clean(body?.provider_reference);
      if (providerReference && !providerReference.startsWith("bp-maintenance-")) {
        return json({ success: false, error: "invalid_provider_reference" }, 400);
      }
      return json({ success: true, data: await reconcileInvoices(providerReference || undefined) });
    }
    return json({ success: true, data: await drainInvoices() });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("flutterwave_subscription_collection_failed", { error: message });
    return json({ success: false, error: message.slice(0, 500) }, 500);
  }
});

