import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") || SERVICE_ROLE;
const INACTIVITY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

type VaRow = {
  bridge_virtual_account_id: string;
  bridge_customer_id: string;
  user_id: string | null;
  business_user_id: string | null;
  currency: string;
  status: string;
  activated_at: string;
  account_details: Record<string, unknown> | null;
};

async function firstQualifyingIncomingAt(userId: string): Promise<number> {
  const { data, error } = await supabase.from("bridge_balance_ledger")
    .select("created_at")
    .or(`user_id.eq.${userId},business_user_id.eq.${userId}`)
    .eq("provider", "bridge")
    .eq("direction", "credit")
    .gt("amount_minor", 0)
    .in("currency", ["USD", "EUR", "GBP", "USDC", "USDT"])
    .in("entity_type", ["virtual_account", "wallet"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("incoming_funds_lookup_failed");
  return timestamp(data?.created_at);
}

async function sendInactiveEmail(input: {
  lifecycleId: string;
  userId: string;
  isBusiness: boolean;
  currency: string;
  virtualAccountId: string;
}): Promise<{ sent: boolean; error?: string }> {
  const [{ data: profile }, businessResult] = await Promise.all([
    supabase.from("user_profiles").select("email,full_name,is_admin").eq("id", input.userId).maybeSingle(),
    input.isBusiness
      ? supabase.from("business_profiles").select("company_name").eq("user_id", input.userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const email = String(profile?.email || "").trim();
  if (!email || profile?.is_admin === true) return { sent: false, error: "confirmed_recipient_missing" };
  const { data: authUser } = await supabase.auth.admin.getUserById(input.userId);
  if (!authUser?.user?.email_confirmed_at) return { sent: false, error: "confirmed_recipient_missing" };

  const template = input.isBusiness
    ? "business.virtual_account_inactive"
    : "individual.virtual_account_inactive";
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify({
      template,
      to: email,
      user_id: input.userId,
      idempotency_key: `va-inactive:${input.virtualAccountId}:${input.lifecycleId}`,
      props: {
        full_name: profile?.full_name || null,
        company_name: businessResult?.data?.company_name || null,
        currency: input.currency,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, error: `send-email HTTP ${response.status}: ${detail.slice(0, 180)}` };
  }
  return { sent: true };
}

async function retryPendingEmails(limit: number): Promise<{ sent: number; failed: number }> {
  const { data } = await supabase.from("va_inactivity_deactivations")
    .select("id,user_id,currency,bridge_virtual_account_id")
    .not("provider_deactivated_at", "is", null)
    .is("email_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const row of data || []) {
    const { data: va } = await supabase.from("bridge_virtual_accounts")
      .select("business_user_id")
      .eq("bridge_virtual_account_id", row.bridge_virtual_account_id)
      .maybeSingle();
    const result = await sendInactiveEmail({
      lifecycleId: row.id,
      userId: row.user_id,
      isBusiness: Boolean(va?.business_user_id),
      currency: row.currency,
      virtualAccountId: row.bridge_virtual_account_id,
    });
    await supabase.from("va_inactivity_deactivations").update({
      ...(result.sent ? { email_sent_at: new Date().toISOString(), email_last_error: null } : { email_last_error: result.error }),
    }).eq("id", row.id);
    if (result.sent) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!timingSafeEqual(token, SERVICE_ROLE)) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { dry_run?: boolean; limit?: number } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const dryRun = body.dry_run === true;
  const limit = Math.max(1, Math.min(Number(body.limit || 100), 500));
  const now = Date.now();
  const cutoff = new Date(now - INACTIVITY_DAYS * DAY_MS).toISOString();

  const emailRetry = dryRun ? { sent: 0, failed: 0 } : await retryPendingEmails(limit);
  const { data: rows, error } = await supabase.from("bridge_virtual_accounts")
    .select("bridge_virtual_account_id,bridge_customer_id,user_id,business_user_id,currency,status,activated_at,account_details")
    .eq("status", "active")
    .lte("activated_at", cutoff)
    .order("activated_at", { ascending: true })
    .limit(limit);
  if (error) return json({ success: false, error: error.message }, 500);

  let eligible = 0;
  let deactivated = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const row of (rows || []) as VaRow[]) {
    const userId = String(row.user_id || row.business_user_id || "");
    const activatedAt = timestamp(row.activated_at);
    if (!userId || !activatedAt) { skipped += 1; continue; }

    let qualifyingIncomingAt = 0;
    try {
      qualifyingIncomingAt = await firstQualifyingIncomingAt(userId);
    } catch {
      skipped += 1;
      results.push({ virtual_account_id: row.bridge_virtual_account_id, eligible: false, reason: "incoming_funds_lookup_failed" });
      continue;
    }
    if (qualifyingIncomingAt > 0) {
      skipped += 1;
      results.push({ virtual_account_id: row.bridge_virtual_account_id, eligible: false, reason: "qualifying_incoming_received" });
      continue;
    }
    eligible += 1;
    if (dryRun) {
      results.push({ virtual_account_id: row.bridge_virtual_account_id, eligible: true, would_deactivate: true });
      continue;
    }

    const { data: lifecycle, error: lifecycleError } = await supabase.from("va_inactivity_deactivations")
      .upsert({
        bridge_virtual_account_id: row.bridge_virtual_account_id,
        user_id: userId,
        currency: row.currency,
        activated_at: row.activated_at,
        qualifying_incoming_at: null,
        eligibility_checked_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        attempt_count: 1,
      }, { onConflict: "bridge_virtual_account_id,activated_at" })
      .select("id,provider_deactivated_at")
      .single();
    if (lifecycleError || !lifecycle) {
      failed += 1;
      results.push({ virtual_account_id: row.bridge_virtual_account_id, error: "lifecycle_audit_write_failed" });
      continue;
    }

    try {
      if (!lifecycle.provider_deactivated_at) {
        const providerResult = await bridgeProvider.deactivateVirtualAccount(
          row.bridge_customer_id,
          row.bridge_virtual_account_id,
        );
        if (String(providerResult.status || "").toLowerCase() !== "deactivated") {
          throw new Error(`unexpected_provider_status:${String(providerResult.status || "missing")}`);
        }
      }
      const deactivatedAt = new Date().toISOString();
      const details = row.account_details && typeof row.account_details === "object" ? row.account_details : {};
      const { error: updateError } = await supabase.from("bridge_virtual_accounts").update({
        status: "deactivated",
        deactivated_at: deactivatedAt,
        deactivation_reason: "30_day_inactivity",
        account_details: {
          ...details,
          inactivity_deactivation: {
            reason: "30_day_inactivity",
            activated_at: row.activated_at,
            qualifying_incoming_at: null,
            deactivated_at: deactivatedAt,
          },
        },
      }).eq("bridge_virtual_account_id", row.bridge_virtual_account_id).eq("status", "active");
      if (updateError) throw updateError;
      await supabase.from("va_inactivity_deactivations").update({
        provider_deactivated_at: lifecycle.provider_deactivated_at || deactivatedAt,
        email_last_error: null,
      }).eq("id", lifecycle.id);

      const email = await sendInactiveEmail({
        lifecycleId: lifecycle.id,
        userId,
        isBusiness: Boolean(row.business_user_id),
        currency: row.currency,
        virtualAccountId: row.bridge_virtual_account_id,
      });
      await supabase.from("va_inactivity_deactivations").update({
        ...(email.sent ? { email_sent_at: new Date().toISOString(), email_last_error: null } : { email_last_error: email.error }),
      }).eq("id", lifecycle.id);
      deactivated += 1;
      results.push({ virtual_account_id: row.bridge_virtual_account_id, deactivated: true, email_sent: email.sent });
    } catch (cause) {
      failed += 1;
      const message = cause instanceof Error ? cause.message : String(cause);
      await supabase.from("va_inactivity_deactivations").update({ email_last_error: message.slice(0, 500) }).eq("id", lifecycle.id);
      results.push({ virtual_account_id: row.bridge_virtual_account_id, error: message });
    }
  }

  return json({
    success: failed === 0,
    dry_run: dryRun,
    inactivity_days: INACTIVITY_DAYS,
    activation_anchored: true,
    scanned: rows?.length || 0,
    eligible,
    deactivated,
    skipped,
    failed,
    email_retry: emailRetry,
    results,
  }, failed === 0 ? 200 : 207);
});
