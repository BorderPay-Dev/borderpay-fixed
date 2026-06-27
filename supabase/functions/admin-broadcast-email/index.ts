import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isBridgeBlocked } from "../_shared/providers/bridge-country-policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const BROADCAST_TOKEN = Deno.env.get("ADMIN_BROADCAST_INTERNAL_TOKEN") ?? "";
const MARKETING_EMAILS_ENABLED = (Deno.env.get("MARKETING_EMAILS_ENABLED") ?? "false").trim().toLowerCase() === "true";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Body {
  action?: string;
  dry_run?: boolean;
  limit?: number;
  start_index?: number;
  max_recipients?: number;
  campaign_id?: string;
}

type BroadcastAction =
  | "business_verification_delay"
  | "business_platform_live"
  | "individual_platform_live"
  | "borderpay_live"
  | "individual_verification_reminder"
  | "business_verification_reminder"
  | "verification_reminder_all"
  | "verification_tos_stuck_recovery"
  | "verification_pending_no_attempt"
  | "verification_business_kyb_completion";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  let authorized = false;

  // Service-to-service trigger path (automation/runbooks).
  if (BROADCAST_TOKEN && token === BROADCAST_TOKEN) {
    authorized = true;
  }

  // Admin panel path: allow authenticated BorderPay admins to trigger the same
  // broadcast action without exposing internal tokens in the browser.
  if (!authorized && token) {
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    const callerUserId = authData?.user?.id || "";
    if (!authErr && callerUserId) {
      const { data: callerProfile } = await supabase
        .from("user_profiles")
        .select("is_admin")
        .eq("id", callerUserId)
        .maybeSingle();
      if (callerProfile?.is_admin === true) {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    return json({ success: false, error: "Unauthorized — admin access required" }, 401);
  }
  if (!MARKETING_EMAILS_ENABLED) {
    return json({ success: false, error: "Marketing emails are disabled in production." }, 403);
  }
  if (!SEND_EMAIL_TOKEN) {
    return json({ success: false, error: "SEND_EMAIL_INTERNAL_TOKEN is not configured" }, 500);
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = String(body.action || "business_verification_delay") as BroadcastAction;
  const supportedActions = new Set<BroadcastAction>([
    "borderpay_live",
    "business_verification_delay",
    "business_platform_live",
    "individual_platform_live",
    "individual_verification_reminder",
    "business_verification_reminder",
    "verification_reminder_all",
    "verification_tos_stuck_recovery",
    "verification_pending_no_attempt",
    "verification_business_kyb_completion",
  ]);
  if (!supportedActions.has(action)) {
    return json({ success: false, error: "unsupported action" }, 400);
  }

  const dryRun = body.dry_run !== false;
  const limit = Math.max(1, Math.min(Number(body.limit || 2000), 10000));
  const startIndex = Math.max(0, Number(body.start_index || 0));
  const maxRecipients = Math.max(1, Math.min(Number(body.max_recipients || 2000), 10000));
  const campaignIdRaw = String(body.campaign_id || "v2").trim();
  const campaignId = /^[a-zA-Z0-9._-]{1,64}$/.test(campaignIdRaw) ? campaignIdRaw : "v2";

  const [{ data: profiles, error: profilesErr }, { data: bizProfiles, error: bizErr }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("id, email, full_name, country, account_type, is_admin, bridge_kyc_status")
      .not("email", "is", null)
      .limit(limit),
    supabase
      .from("business_profiles")
      .select("user_id, company_name, bridge_kyb_status"),
  ]);
  if (profilesErr) return json({ success: false, error: profilesErr.message }, 500);
  if (bizErr) return json({ success: false, error: bizErr.message }, 500);

  const bizNameByUser = new Map<string, string>();
  const bizStatusByUser = new Map<string, string>();
  for (const row of bizProfiles || []) {
    bizNameByUser.set(String((row as Record<string, unknown>).user_id || ""), String((row as Record<string, unknown>).company_name || ""));
    bizStatusByUser.set(
      String((row as Record<string, unknown>).user_id || ""),
      String((row as Record<string, unknown>).bridge_kyb_status || "not_started").toLowerCase(),
    );
  }

  const kycOpen = new Set(["not_started", "pending", "under_review", "incomplete"]);
  const kybOpen = new Set(["not_started", "pending", "under_review", "incomplete"]);
  const segmentNeedsTrace = action === "verification_tos_stuck_recovery" || action === "verification_pending_no_attempt";
  const invokedUserIds = new Set<string>();
  const tosSeenUserIds = new Set<string>();
  if (segmentNeedsTrace) {
    const { data: traces, error: traceErr } = await supabase
      .from("bridge_kyc_traces")
      .select("user_id, stage, response_body, created_at")
      .in("stage", ["invoked", "returned_success"])
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (traceErr) return json({ success: false, error: traceErr.message }, 500);
    for (const row of traces || []) {
      const userId = String((row as Record<string, unknown>).user_id || "");
      if (!userId) continue;
      const stage = String((row as Record<string, unknown>).stage || "");
      if (stage === "invoked") {
        invokedUserIds.add(userId);
      } else if (stage === "returned_success") {
        if (tosSeenUserIds.has(userId)) continue; // rows are desc by created_at
        const body = (row as Record<string, unknown>).response_body as Record<string, unknown> | null;
        const tosSeen = Boolean(body && body["tos_link_present"] === true);
        if (tosSeen) tosSeenUserIds.add(userId);
      }
    }
  }

  const candidates = (profiles || []).filter((p: Record<string, unknown>) => {
    if (p.is_admin === true) return false;
    const email = String(p.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return false;
    if (email === "founder@borderpayafrica.com") return false;
    const country = String(p.country || "").trim().toUpperCase();
    if (isBridgeBlocked(country)) return false;
    const at = String(p.account_type || "").toLowerCase();
    if ((action === "business_verification_delay" || action === "business_platform_live") && at !== "business") return false;
    if (action === "individual_platform_live" && at !== "individual") return false;
    if (action === "individual_verification_reminder") {
      return at === "individual" && kycOpen.has(String(p.bridge_kyc_status || "not_started").toLowerCase());
    }
    if (action === "business_verification_reminder") {
      return at === "business" && kybOpen.has(String(bizStatusByUser.get(String(p.id || "")) || "not_started").toLowerCase());
    }
    if (action === "verification_reminder_all") {
      if (at === "individual") return kycOpen.has(String(p.bridge_kyc_status || "not_started").toLowerCase());
      if (at === "business") return kybOpen.has(String(bizStatusByUser.get(String(p.id || "")) || "not_started").toLowerCase());
      return false;
    }
    if (action === "verification_tos_stuck_recovery") {
      return at === "individual"
        && kycOpen.has(String(p.bridge_kyc_status || "not_started").toLowerCase())
        && tosSeenUserIds.has(String(p.id || ""));
    }
    if (action === "verification_pending_no_attempt") {
      return at === "individual"
        && kycOpen.has(String(p.bridge_kyc_status || "not_started").toLowerCase())
        && !invokedUserIds.has(String(p.id || ""));
    }
    if (action === "verification_business_kyb_completion") {
      return at === "business"
        && kybOpen.has(String(bizStatusByUser.get(String(p.id || "")) || "not_started").toLowerCase());
    }
    return true;
  });

  // Check email-confirmed state from auth.users.
  const confirmed: Array<Record<string, unknown>> = [];
  for (const c of candidates) {
    const userId = String(c.id || "");
    if (!userId) continue;
    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    if (!authUser?.user?.email_confirmed_at) continue;
    confirmed.push(c);
  }

  const selected = confirmed.slice(startIndex, startIndex + maxRecipients);
  const preview = selected.slice(0, 50).map((u) => ({
    user_id: String(u.id || ""),
    email: String(u.email || "").trim().toLowerCase(),
    account_type: String(u.account_type || "individual").toLowerCase(),
  }));

  if (dryRun) {
    return json({
      success: true,
      data: {
        dry_run: true,
        eligible_recipients: confirmed.length,
        selected_recipients: selected.length,
        start_index: startIndex,
        max_recipients: maxRecipients,
        preview,
      },
    });
  }

  const sent: Array<{ user_id: string; email: string; template: string; status: number }> = [];
  const failed: Array<{ user_id: string; email: string; error: string }> = [];
  for (const u of selected) {
    const userId = String(u.id || "");
    const email = String(u.email || "").trim().toLowerCase();
    const accountType = String(u.account_type || "individual").toLowerCase();
    const template =
      action === "business_verification_delay" ? "business.platform_live" :
      action === "business_platform_live" ? "business.platform_live" :
      action === "verification_business_kyb_completion" ? "business.verification_authorized" :
      action === "business_verification_reminder" ? "business.verification_authorized" :
      action === "verification_tos_stuck_recovery" ? "individual.verification_authorized" :
      action === "verification_pending_no_attempt" ? "individual.verification_authorized" :
      action === "individual_verification_reminder" ? "individual.verification_authorized" :
      action === "verification_reminder_all"
        ? (accountType === "business" ? "business.verification_authorized" : "individual.verification_authorized") :
      action === "individual_platform_live" ? "individual.platform_live" :
      (accountType === "business" ? "business.platform_live" : "individual.platform_live");
    const props = template === "business.platform_live"
      ? { company_name: bizNameByUser.get(userId) || "Your business" }
      : template === "business.verification_authorized"
        ? { company_name: bizNameByUser.get(userId) || "Your business", full_name: String(u.full_name || "") }
      : { full_name: String(u.full_name || "") };
    const idempotencyKey = `broadcast:${action}:${campaignId}:${userId}`;

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
        },
        body: JSON.stringify({
          template,
          to: email,
          user_id: userId,
          idempotency_key: idempotencyKey,
          props,
        }),
      });
      if (res.ok) {
        sent.push({ user_id: userId, email, template, status: res.status });
      } else {
        const text = await res.text().catch(() => "");
        failed.push({ user_id: userId, email, error: `HTTP ${res.status} ${text.slice(0, 160)}` });
      }
    } catch (e) {
      failed.push({ user_id: userId, email, error: (e as Error).message });
    }
  }

  return json({
    success: failed.length === 0,
    data: {
      dry_run: false,
      eligible_recipients: confirmed.length,
      selected_recipients: selected.length,
      start_index: startIndex,
      max_recipients: maxRecipients,
      sent_count: sent.length,
      failed_count: failed.length,
      failed,
    },
  }, failed.length === 0 ? 200 : 207);
});
