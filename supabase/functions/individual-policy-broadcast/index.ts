import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const BROADCAST_TOKEN = Deno.env.get("INDIVIDUAL_POLICY_BROADCAST_TOKEN") ?? "";
const TEMPLATE = "individual.business_only_transition";
const CAMPAIGN_VERSION = "2026-08-24-v1";
const EFFECTIVE_DATE = "August 24, 2026";
const BATCH_SIZE = 30;
const SEND_CONFIRMATION = "SEND_INDIVIDUAL_POLICY_NOTICE";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function timingSafeEqualStr(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length === 0 || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ success: false, error: "Server configuration missing" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const internalAuthorized = timingSafeEqualStr(token, BROADCAST_TOKEN);
  if (!internalAuthorized) {
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

    const { data: admin, error: adminError } = await db
      .from("admin_users")
      .select("user_id,role,is_active")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (adminError) return json({ success: false, error: "Admin authorization unavailable" }, 503);
    const role = String(admin?.role || "").trim().toLowerCase();
    if (!admin?.user_id || admin.is_active !== true || !["admin", "admin_super", "super_admin", "support_admin"].includes(role)) {
      return json({ success: false, error: "Admin access required" }, 403);
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  const dryRun = body.dry_run !== false;
  const startIndexRaw = Number(body.start_index ?? 0);
  if (!Number.isInteger(startIndexRaw) || startIndexRaw < 0) {
    return json({ success: false, error: "start_index must be a non-negative integer" }, 400);
  }
  if (!dryRun && body.confirmation !== SEND_CONFIRMATION) {
    return json({ success: false, error: "Explicit send confirmation required" }, 400);
  }
  if (!dryRun && !SEND_EMAIL_TOKEN) {
    return json({ success: false, error: "Email sender is not configured" }, 500);
  }

  const { count, error: countError } = await db
    .from("user_profiles")
    .select("id", { count: "exact", head: true })
    .eq("account_type", "individual")
    .eq("is_admin", false)
    .not("email", "is", null);
  if (countError) return json({ success: false, error: "Recipient count unavailable" }, 503);

  const { data: rows, error: profilesError } = await db
    .from("user_profiles")
    .select("id,email,full_name,account_type,is_admin,created_at")
    .eq("account_type", "individual")
    .eq("is_admin", false)
    .not("email", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(startIndexRaw, startIndexRaw + BATCH_SIZE - 1);
  if (profilesError) return json({ success: false, error: "Recipient lookup unavailable" }, 503);

  const recipients = (rows || []).filter((row) => {
    const email = String(row.email || "").trim();
    return row.account_type === "individual" && row.is_admin === false && email.includes("@");
  });
  const preview = recipients.map((row) => ({
    user_id: String(row.id),
    email: String(row.email).trim().toLowerCase(),
    full_name: String(row.full_name || ""),
  }));
  const nextStartIndex = startIndexRaw + (rows?.length || 0);
  const hasMore = nextStartIndex < (count || 0);

  if (dryRun) {
    return json({
      success: true,
      data: {
        dry_run: true,
        campaign: CAMPAIGN_VERSION,
        template: TEMPLATE,
        effective_date: EFFECTIVE_DATE,
        eligible_recipients: count || 0,
        selected_recipients: recipients.length,
        batch_size: BATCH_SIZE,
        start_index: startIndexRaw,
        next_start_index: nextStartIndex,
        has_more: hasMore,
        preview,
      },
    });
  }

  const sent: Array<{ user_id: string; email: string; status: string }> = [];
  const failed: Array<{ user_id: string; email: string; error: string }> = [];
  for (const recipient of preview) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SEND_EMAIL_TOKEN}` },
        body: JSON.stringify({
          template: TEMPLATE,
          to: recipient.email,
          user_id: recipient.user_id,
          idempotency_key: `broadcast:${CAMPAIGN_VERSION}:${recipient.user_id}`,
          props: { full_name: recipient.full_name, effective_date: EFFECTIVE_DATE },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true || result?.data?.status === "failed") {
        failed.push({ user_id: recipient.user_id, email: recipient.email, error: String(result?.error || `send-email HTTP ${response.status}`) });
      } else {
        sent.push({ user_id: recipient.user_id, email: recipient.email, status: String(result?.data?.status || "sent") });
      }
    } catch (error) {
      failed.push({ user_id: recipient.user_id, email: recipient.email, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return json({
    success: failed.length === 0,
    data: {
      dry_run: false,
      campaign: CAMPAIGN_VERSION,
      eligible_recipients: count || 0,
      selected_recipients: recipients.length,
      sent_count: sent.length,
      failed_count: failed.length,
      failed,
      start_index: startIndexRaw,
      next_start_index: nextStartIndex,
      has_more: hasMore,
    },
  }, failed.length === 0 ? 200 : 207);
});
