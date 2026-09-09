import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const CAMPAIGN = "eur-named-accounts-2026-09-02-v1";
const BATCH_SIZE = 30;
const SEND_CONFIRMATION = "SEND_EUR_NAMED_ACCOUNT_NOTICE";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ success: false, error: "Server configuration missing" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
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

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const dryRun = body.dry_run !== false;
  const startIndex = Number(body.start_index ?? 0);
  if (!Number.isInteger(startIndex) || startIndex < 0) {
    return json({ success: false, error: "start_index must be a non-negative integer" }, 400);
  }
  if (!dryRun && body.confirmation !== SEND_CONFIRMATION) {
    return json({ success: false, error: "Explicit send confirmation required" }, 400);
  }
  if (!dryRun && !SEND_EMAIL_TOKEN) return json({ success: false, error: "Email sender is not configured" }, 500);

  // Target only customers who actually own an active EUR virtual account.
  // This avoids sending a provider-specific operational notice to unrelated users.
  const { data: accountRows, error: accountsError } = await db
    .from("bridge_virtual_accounts")
    .select("user_id,business_user_id,currency,status")
    .ilike("currency", "eur")
    .in("status", ["active", "activated", "enabled"])
    .limit(10000);
  if (accountsError) return json({ success: false, error: "EUR account lookup unavailable" }, 503);

  const ownerIds = Array.from(new Set((accountRows || [])
    .map((row: any) => String(row.business_user_id || row.user_id || "").trim())
    .filter(Boolean)))
    .sort();

  const { data: profileRows, error: profilesError } = ownerIds.length
    ? await db.from("user_profiles").select("id,email,full_name,is_admin").in("id", ownerIds)
    : { data: [], error: null };
  if (profilesError) return json({ success: false, error: "Recipient lookup unavailable" }, 503);

  const allRecipients = (profileRows || [])
    .filter((row: any) => row.is_admin !== true && String(row.email || "").includes("@"))
    .map((row: any) => ({
      user_id: String(row.id),
      email: String(row.email).trim().toLowerCase(),
      full_name: String(row.full_name || ""),
    }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id));
  const recipients = allRecipients.slice(startIndex, startIndex + BATCH_SIZE);
  const nextStartIndex = startIndex + recipients.length;
  const hasMore = nextStartIndex < allRecipients.length;

  if (dryRun) {
    return json({ success: true, data: {
      dry_run: true,
      campaign: CAMPAIGN,
      eligible_recipients: allRecipients.length,
      selected_recipients: recipients.length,
      start_index: startIndex,
      next_start_index: nextStartIndex,
      has_more: hasMore,
      preview: recipients,
    } });
  }

  const failed: Array<{ user_id: string; email: string; error: string }> = [];
  let sentCount = 0;
  for (const recipient of recipients) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SEND_EMAIL_TOKEN}` },
        body: JSON.stringify({
          template: "account.eur_named_account_announcement",
          to: recipient.email,
          user_id: recipient.user_id,
          idempotency_key: `broadcast:${CAMPAIGN}:${recipient.user_id}`,
          props: { full_name: recipient.full_name },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success !== true || result?.data?.status === "failed") {
        failed.push({ user_id: recipient.user_id, email: recipient.email, error: String(result?.error || `send-email HTTP ${response.status}`) });
      } else sentCount += 1;
    } catch (error) {
      failed.push({ user_id: recipient.user_id, email: recipient.email, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return json({ success: failed.length === 0, data: {
    dry_run: false,
    campaign: CAMPAIGN,
    eligible_recipients: allRecipients.length,
    selected_recipients: recipients.length,
    sent_count: sentCount,
    failed_count: failed.length,
    failed,
    start_index: startIndex,
    next_start_index: nextStartIndex,
    has_more: hasMore,
  } }, failed.length === 0 ? 200 : 207);
});
