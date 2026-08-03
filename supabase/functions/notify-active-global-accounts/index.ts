import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") || SUPABASE_SERVICE_ROLE;
const BACKFILL_TOKEN = Deno.env.get("VA_NOTIFY_BACKFILL_TOKEN") || "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}

async function resolveEmailRecipient(userId: string): Promise<{ email: string; full_name: string | null } | null> {
  const { data: prof } = await supabase
    .from("user_profiles")
    .select("email,is_admin,full_name")
    .eq("id", userId)
    .maybeSingle();
  const email = String(prof?.email || "").trim();
  if (!email || prof?.is_admin === true) return null;
  const { data: au } = await supabase.auth.admin.getUserById(userId);
  if (!au?.user?.email_confirmed_at) return null;
  return { email, full_name: prof?.full_name ?? null };
}

type AccountType = "individual" | "business";
type ActiveVaRow = {
  bridge_virtual_account_id: string;
  currency: string;
  status: string;
  user_id: string | null;
  business_user_id: string | null;
  rail?: string | null;
  account_details?: Record<string, unknown> | null;
};

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function blockedAccountStatus(value: unknown): boolean {
  return ["paused", "suspended", "frozen", "rejected", "offboarded", "deactivated", "closed"].includes(normalized(value));
}

async function resolveVerifiedLimitsRecipient(userId: string, accountType: AccountType): Promise<{
  email: string;
  full_name: string | null;
  company_name: string | null;
} | null> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("email,is_admin,full_name,kyc_status,bridge_kyc_status,bridge_account_status,account_status")
    .eq("id", userId)
    .maybeSingle();
  const email = String(profile?.email || "").trim();
  if (!email || profile?.is_admin === true) return null;
  if (blockedAccountStatus(profile?.account_status) || blockedAccountStatus(profile?.bridge_account_status)) return null;
  if (!new Set(["verified", "approved", "active", "full_enrollment"]).has(normalized(profile?.kyc_status))) return null;

  let companyName: string | null = null;
  if (accountType === "business") {
    const { data: business } = await supabase
      .from("business_profiles")
      .select("company_name,status,bridge_kyb_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!business || blockedAccountStatus(business.status)) return null;
    if (!["verified", "approved", "active"].includes(normalized(business.bridge_kyb_status))) return null;
    companyName = business.company_name ?? null;
  } else if (!["verified", "approved", "active"].includes(normalized(profile?.bridge_kyc_status))) {
    return null;
  }

  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  if (!authUser?.user?.email_confirmed_at) return null;
  return { email, full_name: profile?.full_name ?? null, company_name: companyName };
}

function virtualAccountLimitRows(rows: ActiveVaRow[]): Array<Record<string, string>> {
  return rows.map((row) => {
    const currency = String(row.currency || "").toUpperCase();
    const accountDetails = row.account_details && typeof row.account_details === "object" ? row.account_details : {};
    const source = accountDetails.source_deposit_instructions && typeof accountDetails.source_deposit_instructions === "object"
      ? accountDetails.source_deposit_instructions as Record<string, unknown>
      : {};
    const railRaw = String(row.rail || source.payment_rail || (Array.isArray(source.payment_rails) ? source.payment_rails[0] : "") || "").toLowerCase();
    const rail = railRaw === "ach" || railRaw === "ach_push"
      ? "ACH / Wire / FedNow"
      : railRaw === "sepa"
        ? "SEPA"
        : railRaw === "faster_payments"
          ? "Faster Payments"
          : currency === "USD"
            ? "ACH / Wire / FedNow"
            : currency === "EUR"
              ? "SEPA"
              : currency === "GBP"
                ? "Faster Payments"
                : "Bank transfer";
    if (currency === "USD") {
      return {
        currency, rail, account_label: `${currency} - ${rail}`,
        minimum: "No published minimum",
        maximum: "No published standard maximum",
        accepted_payments: "Own-account payments, business payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000.",
        important_note: "USD person-to-person payments must stay under $4,000 and are not supported from New York or Texas.",
      };
    }
    if (currency === "EUR") {
      return {
        currency, rail, account_label: `${currency} - ${rail}`,
        minimum: "No published minimum",
        maximum: "No published standard maximum. Payments over EUR 1,000,000 use SEPA Credit and may take 1 business day.",
        accepted_payments: "Own-account payments and business payments are supported. Contact BorderPay before receiving EUR SEPA from an individual.",
        important_note: "Individual third-party EUR SEPA payments need support review before use. Contact us first to avoid a preventable refund.",
      };
    }
    return {
      currency, rail, account_label: `${currency} - ${rail}`,
      minimum: "No published minimum",
      maximum: "No published standard maximum. Payments over GBP 1,000,000 use BACS and may take 3 business days.",
      accepted_payments: "Own-account payments and business payments are supported.",
      important_note: "GBP does not support incoming payments from individuals. Use GBP for company, employer, platform, or client business payments only.",
    };
  });
}

async function alreadySent(idempotencyKey: string): Promise<boolean> {
  const { data } = await supabase
    .from("email_log")
    .select("id,status")
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "sent")
    .maybeSingle();
  return Boolean(data?.id);
}

async function sendGlobalAccountReady(input: {
  userId: string;
  accountType: "individual" | "business";
  currency: string;
  virtualAccountId: string;
}): Promise<{ sent: boolean; skipped?: string; error?: string }> {
  const idempotencyKey = `wh:va-ready:${input.userId}:${input.virtualAccountId}:${input.currency}`;
  if (await alreadySent(idempotencyKey)) return { sent: false, skipped: "already_sent" };

  const rcpt = await resolveEmailRecipient(input.userId);
  if (!rcpt) return { sent: false, skipped: "no_confirmed_recipient" };

  let template: string;
  let props: Record<string, unknown>;
  if (input.accountType === "business") {
    const { data: biz } = await supabase
      .from("business_profiles")
      .select("company_name")
      .eq("user_id", input.userId)
      .maybeSingle();
    template = "business.account_ready";
    props = {
      company_name: biz?.company_name ?? null,
      product: "virtual_account",
      outcome: "provisioned",
      currency: input.currency,
    };
  } else {
    template = "individual.account_ready";
    props = {
      full_name: rcpt.full_name,
      product: "virtual_account",
      outcome: "provisioned",
      currency: input.currency,
    };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify({
      template,
      to: rcpt.email,
      user_id: input.userId,
      idempotency_key: idempotencyKey,
      props,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { sent: false, error: `send-email HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  await sendAccountInstructionsBestEffort(input.virtualAccountId);
  return { sent: true };
}

async function sendVirtualAccountLimitsCampaign(input: {
  userId: string;
  accountType: AccountType;
  rows: ActiveVaRow[];
  campaignKey: string;
}): Promise<{ sent: boolean; skipped?: string; error?: string }> {
  if (input.rows.length === 0) return { sent: false, skipped: "no_active_virtual_accounts" };
  const recipient = await resolveVerifiedLimitsRecipient(input.userId, input.accountType);
  if (!recipient) return { sent: false, skipped: "not_verified_or_not_confirmed" };
  const idempotencyKey = `campaign:virtual-account-limits:${input.campaignKey}:${input.userId}`;
  if (await alreadySent(idempotencyKey)) return { sent: false, skipped: "already_sent" };

  const template = input.accountType === "business"
    ? "business.virtual_account_limits"
    : "individual.virtual_account_limits";
  const props: Record<string, unknown> = {
    full_name: recipient.full_name,
    company_name: recipient.company_name,
    virtual_accounts: virtualAccountLimitRows(input.rows),
    action_url: `${Deno.env.get("APP_URL") || "https://app.borderpayafrica.com"}/dashboard`,
  };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify({
      template,
      to: recipient.email,
      user_id: input.userId,
      idempotency_key: idempotencyKey,
      props,
    }),
  });
  if (!res.ok) {
    const responseText = await res.text().catch(() => "");
    return { sent: false, error: `send-email HTTP ${res.status}: ${responseText.slice(0, 200)}` };
  }
  return { sent: true };
}

async function sendAccountInstructionsBestEffort(virtualAccountId: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/bridge-va-account-letter`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        action: "send",
        bridge_virtual_account_id: virtualAccountId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, error: `bridge-va-account-letter HTTP ${res.status}`, details: data };
    return data as Record<string, unknown>;
  } catch (e) {
    console.warn(`account instructions send skipped: ${(e as Error).message}`);
    return { sent: false, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const backfillOk = BACKFILL_TOKEN ? timingSafeEqualStr(token, BACKFILL_TOKEN) : false;
  const internalOk = SEND_EMAIL_TOKEN ? timingSafeEqualStr(token, SEND_EMAIL_TOKEN) : false;
  const serviceRoleOk = SUPABASE_SERVICE_ROLE ? timingSafeEqualStr(token, SUPABASE_SERVICE_ROLE) : false;
  if (!(backfillOk || internalOk || serviceRoleOk)) return json({ success: false, error: "Unauthorized" }, 401);

  let body: {
    dry_run?: boolean;
    limit?: number;
    user_ids?: string[];
    currencies?: string[];
    account_instructions_only?: boolean;
    mode?: "account_ready" | "account_instructions_only" | "limits_campaign";
    campaign_key?: string;
  } = {};
  try { body = await req.json(); } catch { /* empty allowed */ }

  const limit = Math.max(1, Math.min(Number(body.limit || 100), 500));
  const currencies = Array.isArray(body.currencies)
    ? body.currencies.map((c) => String(c).toUpperCase()).filter((c) => ["USD", "EUR", "GBP"].includes(c))
    : [];
  const userIds = Array.isArray(body.user_ids)
    ? body.user_ids.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const mode = body.mode === "limits_campaign"
    ? "limits_campaign"
    : (body.mode === "account_instructions_only" || body.account_instructions_only)
      ? "account_instructions_only"
      : "account_ready";
  const campaignKey = String(body.campaign_key || "active-global-account-limits-v1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 80) || "active-global-account-limits-v1";

  let query = supabase
    .from("bridge_virtual_accounts")
    .select("bridge_virtual_account_id,currency,status,user_id,business_user_id,rail,account_details,created_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (currencies.length > 0) query = query.in("currency", currencies);

  const { data: rows, error } = await query;
  if (error) return json({ success: false, error: error.message }, 500);

  const selected = (rows || []).filter((row: any) => {
    const owner = String(row.user_id || row.business_user_id || "");
    if (!owner) return false;
    if (userIds.length > 0 && !userIds.includes(owner)) return false;
    return true;
  });

  if (mode === "limits_campaign") {
    const grouped = new Map<string, { accountType: AccountType; rows: ActiveVaRow[] }>();
    for (const row of selected as ActiveVaRow[]) {
      const userId = String(row.user_id || row.business_user_id || "");
      if (!userId) continue;
      const accountType: AccountType = row.business_user_id ? "business" : "individual";
      const existing = grouped.get(userId) || { accountType, rows: [] };
      existing.rows.push(row);
      grouped.set(userId, existing);
    }

    const results: Array<Record<string, unknown>> = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const [userId, group] of grouped) {
      const idempotencyKey = `campaign:virtual-account-limits:${campaignKey}:${userId}`;
      if (body.dry_run) {
        const recipient = await resolveVerifiedLimitsRecipient(userId, group.accountType);
        const wasSent = recipient ? await alreadySent(idempotencyKey) : false;
        const wouldSend = Boolean(recipient && !wasSent && group.rows.length > 0);
        if (!wouldSend) skipped += 1;
        results.push({
          user_id: userId,
          account_type: group.accountType,
          active_virtual_account_count: group.rows.length,
          currencies: [...new Set(group.rows.map((row) => String(row.currency || "").toUpperCase()))],
          verified_recipient: Boolean(recipient),
          would_send: wouldSend,
          skipped: !recipient ? "not_verified_or_not_confirmed" : wasSent ? "already_sent" : null,
        });
        continue;
      }
      const result = await sendVirtualAccountLimitsCampaign({
        userId,
        accountType: group.accountType,
        rows: group.rows,
        campaignKey,
      });
      if (result.sent) sent += 1;
      else if (result.error) failed += 1;
      else skipped += 1;
      results.push({
        user_id: userId,
        account_type: group.accountType,
        active_virtual_account_count: group.rows.length,
        currencies: [...new Set(group.rows.map((row) => String(row.currency || "").toUpperCase()))],
        ...result,
      });
    }
    return json({
      success: true,
      mode,
      campaign_key: campaignKey,
      dry_run: Boolean(body.dry_run),
      scanned_active_virtual_accounts: selected.length,
      scanned_users: grouped.size,
      sent,
      skipped,
      failed,
      results,
    });
  }

  const results: Array<Record<string, unknown>> = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of selected) {
    const userId = String((row as any).user_id || (row as any).business_user_id || "");
    const accountType = (row as any).business_user_id ? "business" : "individual";
    const currency = String((row as any).currency || "").toUpperCase();
    const virtualAccountId = String((row as any).bridge_virtual_account_id || "");
    const idempotencyKey = `wh:va-ready:${userId}:${virtualAccountId}:${currency}`;
    if (!userId || !virtualAccountId || !currency) {
      skipped += 1;
      results.push({ user_id: userId, currency, virtual_account_id: virtualAccountId, skipped: "missing_required_fields" });
      continue;
    }
    if (body.dry_run) {
      const wasSent = await alreadySent(idempotencyKey);
      skipped += wasSent ? 1 : 0;
      results.push({
        user_id: userId,
        account_type: accountType,
        currency,
        virtual_account_id: virtualAccountId,
        would_send: mode === "account_instructions_only" ? true : !wasSent,
        mode,
        skipped: mode !== "account_instructions_only" && wasSent ? "already_sent" : null,
      });
      continue;
    }
    const result = mode === "account_instructions_only"
      ? await sendAccountInstructionsBestEffort(virtualAccountId)
      : await sendGlobalAccountReady({ userId, accountType, currency, virtualAccountId });
    if (result.sent) sent += 1;
    else if (result.error) failed += 1;
    else skipped += 1;
    results.push({ user_id: userId, account_type: accountType, currency, virtual_account_id: virtualAccountId, ...result });
  }

  return json({
    success: true,
    dry_run: Boolean(body.dry_run),
    scanned: selected.length,
    sent,
    skipped,
    failed,
    results,
  });
});
