import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("WORKER_AUTH_TOKEN") ?? "";
const EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? SERVICE_ROLE;
const db = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Billing routing is intentionally independent from SCA. It uses the
// verified server-side customer country only to choose invoice collection
// versus wallet collection; it does not gate login or financial screens.
const EEA_BILLING_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
  "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL",
  "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

async function resolveBillingCountry(userId: string): Promise<{ country: string | null; eea: boolean }> {
  const { data, error } = await db.from("user_profiles")
    .select("country,verification_status")
    .eq("id", userId)
    .maybeSingle();
  if (error || data?.verification_status !== "approved") return { country: null, eea: false };
  const country = String(data?.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { country: null, eea: false };
  return { country, eea: EEA_BILLING_COUNTRIES.has(country) };
}

function equal(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

async function billDue() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from("subscriptions")
    .select("id,user_id")
    .eq("status", "active")
    .is("restricted_at", null)
    .lte("next_billing_date", today)
    .limit(500);
  if (error) throw error;
  const results = [];
  const scopedRows = await mapWithConcurrency(data ?? [], 3, async (row) => ({
    row,
    scope: await resolveBillingCountry(row.user_id),
  }));
  for (const { row, scope } of scopedRows) {
    if (scope.eea) {
      const { data: result, error: invoiceError } = await db.rpc("queue_external_subscription_invoice", {
        p_subscription_id: row.id,
        p_billing_date: today,
        p_scope_country: scope.country,
        p_provider: "flutterwave",
      });
      results.push({ id: row.id, route: "flutterwave_invoice", result, error: invoiceError?.message ?? null });
      continue;
    }
    if (!scope.country) {
      results.push({ id: row.id, route: "blocked", result: null, error: "maintenance_region_unresolved" });
      continue;
    }
    try {
      const response = await fetch(`${URL}/functions/v1/subscription-bridge-collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_TOKEN || SERVICE_ROLE}` },
        body: JSON.stringify({ subscription_id: row.id, billing_date: today }),
      });
      const body = await response.json().catch(() => ({}));
      results.push({ id: row.id, route: "bridge_non_eea", result: response.ok ? body?.data ?? body : null, error: response.ok ? null : body?.error || `HTTP ${response.status}` });
    } catch (cause) {
      results.push({ id: row.id, route: "bridge_non_eea", result: null, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { processed: results.length, results };
}

async function drainExternalInvoices() {
  try {
    const response = await fetch(`${URL}/functions/v1/flutterwave-subscription-collection`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_TOKEN || SERVICE_ROLE}` },
      body: JSON.stringify({ mode: "drain" }),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? body?.data ?? body : { configured: false, error: body?.error || `HTTP ${response.status}` };
  } catch (cause) {
    return { configured: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

async function queueUnpaidInvoices() {
  const { data, error } = await db.from("subscriptions")
    .select("id,user_id,next_billing_date")
    .eq("status", "active")
    .in("payment_status", ["failed", "pending"])
    .not("grace_started_at", "is", null)
    .limit(500);
  if (error) throw error;
  const results = await mapWithConcurrency(data ?? [], 3, async (row) => {
    const scope = await resolveBillingCountry(row.user_id);
    if (!scope.country) return { id: row.id, queued: false, error: "maintenance_region_unresolved" };
    const { data: result, error: invoiceError } = await db.rpc("queue_external_subscription_invoice", {
      p_subscription_id: row.id,
      p_billing_date: row.next_billing_date,
      p_scope_country: scope.country,
      p_provider: "flutterwave",
    });
    return { id: row.id, queued: !invoiceError, result, error: invoiceError?.message ?? null };
  });
  return { processed: results.length, results };
}

type AccessAction = {
  id: string;
  subscription_id: string;
  user_id: string;
  bridge_virtual_account_id: string;
  bridge_customer_id: string;
  action: "deactivate" | "reactivate";
  idempotency_key: string;
  attempt_count: number;
};

async function accessEnforcementEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("app_config_get", { p_key: "subscription_access_enforcement_enabled" });
  if (error) return false;
  return String(data ?? "").trim().toLowerCase() === "true";
}

async function reconcileSubscriptionAccess(dryRun = false, limit = 100) {
  const { data: reconciliation, error: reconciliationError } = await db.rpc("reconcile_subscription_access_actions", {
    p_dry_run: dryRun,
    p_limit: Math.max(1, Math.min(limit, 500)),
  });
  if (reconciliationError) throw reconciliationError;
  if (dryRun) return { reconciliation, processed: 0, completed: 0, failed: 0 };
  if (!(await accessEnforcementEnabled())) {
    return { reconciliation, enabled: false, processed: 0, completed: 0, failed: 0 };
  }

  const { data, error } = await db.from("subscription_provider_access_actions")
    .select("id,subscription_id,user_id,bridge_virtual_account_id,bridge_customer_id,action,idempotency_key,attempt_count")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at")
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;

  let completed = 0;
  let failed = 0;
  for (const action of (data ?? []) as AccessAction[]) {
    const claimedAt = new Date().toISOString();
    const { data: claimed } = await db.from("subscription_provider_access_actions")
      .update({ status: "processing", last_attempt_at: claimedAt, attempt_count: action.attempt_count + 1, updated_at: claimedAt })
      .eq("id", action.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed?.id) continue;
    try {
      const providerResult = action.action === "deactivate"
        ? await bridgeProvider.deactivateVirtualAccount(action.bridge_customer_id, action.bridge_virtual_account_id, action.idempotency_key)
        : await bridgeProvider.reactivateVirtualAccount(action.bridge_customer_id, action.bridge_virtual_account_id, action.idempotency_key);
      const providerStatus = String(providerResult.status || "").toLowerCase();
      if (action.action === "deactivate" && providerStatus !== "deactivated") throw new Error(`unexpected_provider_status:${providerStatus || "missing"}`);
      if (action.action === "reactivate" && !["active", "activated"].includes(providerStatus)) throw new Error(`unexpected_provider_status:${providerStatus || "missing"}`);
      const now = new Date().toISOString();
      const { data: va } = await db.from("bridge_virtual_accounts")
        .select("account_details")
        .eq("bridge_virtual_account_id", action.bridge_virtual_account_id)
        .maybeSingle();
      const details = va?.account_details && typeof va.account_details === "object" ? va.account_details as Record<string, unknown> : {};
      const accessMetadata = { action_id: action.id, subscription_id: action.subscription_id, action: action.action, completed_at: now };
      const update = action.action === "deactivate"
        ? { status: "deactivated", deactivated_at: now, deactivation_reason: "subscription_nonpayment", account_details: { ...details, subscription_access_control: accessMetadata } }
        : { status: "active", deactivated_at: null, deactivation_reason: null, account_details: { ...details, subscription_access_control: accessMetadata } };
      const { error: updateError } = await db.from("bridge_virtual_accounts").update(update).eq("bridge_virtual_account_id", action.bridge_virtual_account_id);
      if (updateError) throw updateError;
      await db.from("subscription_provider_access_actions").update({
        status: "completed",
        completed_at: now,
        last_error: null,
        provider_response: {
          virtual_account_id: providerResult.virtual_account_id,
          currency: providerResult.currency,
          rail: providerResult.rail ?? null,
          status: providerResult.status ?? null,
        },
        updated_at: now,
      }).eq("id", action.id);
      completed++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const attempts = action.attempt_count + 1;
      const nextAttempt = new Date(Date.now() + Math.min(86400, 30 * 2 ** attempts) * 1000).toISOString();
      await db.from("subscription_provider_access_actions").update({ status: "failed", last_error: message.slice(0, 500), next_attempt_at: nextAttempt, updated_at: new Date().toISOString() }).eq("id", action.id);
      failed++;
    }
  }
  return { reconciliation, processed: data?.length ?? 0, completed, failed };
}

async function sendEmails() {
  const { data, error } = await db.from("subscription_email_jobs").select("*")
    .eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(30);
  if (error) throw error;
  let sent = 0; let failed = 0;
  for (const job of data ?? []) {
    const response = await fetch(`${URL}/functions/v1/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMAIL_TOKEN}` },
      body: JSON.stringify({ template: job.template, to: job.recipient, user_id: job.user_id, props: job.props, idempotency_key: job.idempotency_key }),
    });
    if (response.ok) {
      await db.from("subscription_email_jobs").update({ status: "sent", sent_at: new Date().toISOString(), attempt_count: job.attempt_count + 1, last_error: null }).eq("id", job.id);
      sent++;
    } else {
      const message = (await response.text()).slice(0, 500);
      const attempts = job.attempt_count + 1;
      const next = new Date(Date.now() + Math.min(86400, 30 * 2 ** attempts) * 1000).toISOString();
      await db.from("subscription_email_jobs").update({ status: attempts >= 8 ? "failed" : "pending", attempt_count: attempts, next_attempt_at: next, last_error: message }).eq("id", job.id);
      failed++;
    }
  }
  return { selected: data?.length ?? 0, sent, failed };
}

async function finalizeRestrictionsAfterEmailDelivery() {
  const { data, error } = await db.rpc("finalize_subscription_restrictions");
  if (error) throw error;
  return data;
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(raw)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deliverEvents() {
  const { data, error } = await db.from("subscription_event_deliveries")
    .select("id,status,attempt_count,event_id,subscription_events(*),subscription_webhook_endpoints(*)")
    .eq("status", "pending").lte("next_attempt_at", new Date().toISOString()).limit(100);
  if (error) throw error;
  let delivered = 0; let failed = 0;
  for (const item of data ?? []) {
    const event = item.subscription_events as unknown as Record<string, unknown>;
    const endpoint = item.subscription_webhook_endpoints as unknown as Record<string, unknown>;
    if (!endpoint?.url || endpoint.enabled === false) continue;
    const body = JSON.stringify(event);
    const signature = await sign(String(endpoint.secret), body);
    try {
      const response = await fetch(String(endpoint.url), { method: "POST", headers: { "Content-Type": "application/json", "X-BorderPay-Event-Id": String(item.event_id), "X-BorderPay-Signature": signature }, body });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await db.from("subscription_event_deliveries").update({ status: "delivered", delivered_at: new Date().toISOString(), attempt_count: item.attempt_count + 1, last_error: null }).eq("id", item.id);
      delivered++;
    } catch (e) {
      const attempts = item.attempt_count + 1;
      await db.from("subscription_event_deliveries").update({ status: attempts >= 10 ? "failed" : "pending", attempt_count: attempts, next_attempt_at: new Date(Date.now() + Math.min(86400, 30 * 2 ** attempts) * 1000).toISOString(), last_error: String(e).slice(0, 500) }).eq("id", item.id);
      failed++;
    }
  }
  return { selected: data?.length ?? 0, delivered, failed };
}

async function queueAnnouncement() {
  const { data: subs, error } = await db.from("subscriptions")
    .select("user_id,account_type,next_billing_date")
    .eq("status", "active")
    .eq("account_type", "business");
  if (error) throw error;
  const ids = (subs ?? []).map((s) => s.user_id);
  const [{ data: profiles, error: profileError }, { data: businesses, error: businessError }] = await Promise.all([
    db.from("user_profiles").select("id,email,full_name,account_type,kyc_status").in("id", ids),
    db.from("business_profiles").select("user_id,company_name,bridge_kyb_status").in("user_id", ids),
  ]);
  if (profileError) throw profileError;
  if (businessError) throw businessError;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const businessById = new Map((businesses ?? []).map((b) => [b.user_id, b]));
  let queued = 0;
  let eligible = 0;
  for (const sub of subs ?? []) {
    const profile = profileById.get(sub.user_id);
    const business = businessById.get(sub.user_id);
    const isVerifiedBusiness = profile?.account_type === "business"
      && String(profile?.kyc_status ?? "").toLowerCase() === "verified"
      && ["approved", "verified"].includes(String(business?.bridge_kyb_status ?? "").toLowerCase());
    if (!isVerifiedBusiness || !profile?.email) continue;
    eligible++;
    const { error: insertError } = await db.from("subscription_email_jobs").insert({
      user_id: sub.user_id,
      template: `${sub.account_type}.subscription_maintenance_announcement`,
      recipient: profile.email.trim().toLowerCase(),
      props: { customer_name: business?.company_name ?? profile.full_name, billing_start_date: sub.next_billing_date },
      idempotency_key: `subscription:maintenance_announcement:2026-08-31:${sub.user_id}`,
    });
    if (!insertError) queued++;
    else if (insertError.code !== "23505") throw insertError;
  }
  return { eligible, queued };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  // Production cron stores its independently rotatable bearer in app_config.
  // Read it with the service client and compare timing-safely; never return or log it.
  const { data: configuredWorkerToken } = await db.rpc("app_config_get", { p_key: "worker_auth_token" });
  if (!(equal(token, WORKER_TOKEN) || equal(token, SERVICE_ROLE) || equal(token, String(configuredWorkerToken ?? "")))) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  try {
    const { mode = "drain" } = await req.json().catch(() => ({}));
    const out: Record<string, unknown> = {};
    if (["bill_due", "drain"].includes(mode)) {
      out.billing = await billDue();
      out.external_invoices = await drainExternalInvoices();
    }
    if (["grace", "drain"].includes(mode)) {
      const { data, error } = await db.rpc("apply_subscription_grace_controls"); if (error) throw error; out.grace = data;
      out.unpaid_invoices = await queueUnpaidInvoices();
      out.external_invoices = await drainExternalInvoices();
      out.access = await reconcileSubscriptionAccess(false);
    }
    if (mode === "access_dry_run") out.access = await reconcileSubscriptionAccess(true);
    if (mode === "access") out.access = await reconcileSubscriptionAccess(false);
    if (mode === "announcement") out.announcement = await queueAnnouncement();
    if (["emails", "drain", "announcement"].includes(mode)) {
      out.emails = await sendEmails();
      out.restrictions = await finalizeRestrictionsAfterEmailDelivery();
      out.access = await reconcileSubscriptionAccess(false);
    }
    if (["events", "drain"].includes(mode)) out.events = await deliverEvents();
    return json({ success: true, data: out });
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === "object" ? JSON.stringify(e) : String(e);
    return json({ success: false, error: message }, 500);
  }
});
