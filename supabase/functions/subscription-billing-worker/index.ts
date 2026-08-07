import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WORKER_TOKEN = Deno.env.get("WORKER_AUTH_TOKEN") ?? "";
const EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? SERVICE_ROLE;
const db = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function equal(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function billDue() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from("subscriptions").select("id").eq("status", "active").lte("next_billing_date", today).limit(500);
  if (error) throw error;
  const results = [];
  for (const row of data ?? []) {
    const { data: result, error: chargeError } = await db.rpc("charge_internal_subscription", { p_subscription_id: row.id, p_billing_date: today });
    results.push({ id: row.id, result, error: chargeError?.message ?? null });
  }
  return { processed: results.length, results };
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
  const { data: subs, error } = await db.from("subscriptions").select("user_id,account_type,next_billing_date").eq("status", "active");
  if (error) throw error;
  const ids = (subs ?? []).map((s) => s.user_id);
  const [{ data: profiles, error: profileError }, { data: businesses, error: businessError }] = await Promise.all([
    db.from("user_profiles").select("id,email,full_name").in("id", ids),
    db.from("business_profiles").select("user_id,company_name").in("user_id", ids),
  ]);
  if (profileError) throw profileError;
  if (businessError) throw businessError;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const businessById = new Map((businesses ?? []).map((b) => [b.user_id, b]));
  let queued = 0;
  for (const sub of subs ?? []) {
    const profile = profileById.get(sub.user_id);
    const business = businessById.get(sub.user_id);
    if (!profile?.email) continue;
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
  return { eligible: subs?.length ?? 0, queued };
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
    if (["bill_due", "drain"].includes(mode)) out.billing = await billDue();
    if (["grace", "drain"].includes(mode)) {
      const { data, error } = await db.rpc("apply_subscription_grace_controls"); if (error) throw error; out.grace = data;
    }
    if (mode === "announcement") out.announcement = await queueAnnouncement();
    if (["emails", "drain", "announcement"].includes(mode)) out.emails = await sendEmails();
    if (["events", "drain"].includes(mode)) out.events = await deliverEvents();
    return json({ success: true, data: out });
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === "object" ? JSON.stringify(e) : String(e);
    return json({ success: false, error: message }, 500);
  }
});
