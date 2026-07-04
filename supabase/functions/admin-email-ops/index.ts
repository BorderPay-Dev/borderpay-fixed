import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const ADMIN_TOKEN = Deno.env.get("ADMIN_BROADCAST_INTERNAL_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type BroadcastCampaign =
  | "founder_welcome"
  | "first_transaction_unlock_reminder"
  | "account_suspended"
  | "verification_reminder"
  | "pin_reset_link";

const TEMPLATE_ALLOWLIST = new Set<string>([
  "individual.email_verification",
  "individual.password_reset",
  "individual.transaction_notification",
  "individual.kyc_decision",
  "individual.account_ready",
  "individual.verification_authorized",
  "individual.verification_reminder",
  "individual.payment_received",
  "individual.platform_live",
  "individual.external_account_status",
  "individual.founder_welcome",
  "individual.first_transaction_reminder",
  "individual.account_suspended",
  "individual.pin_reset_link",
  "business.email_verification",
  "business.kyb_submitted",
  "business.kyb_decision",
  "business.kyb_additional_details",
  "business.transaction_notification",
  "business.account_activated",
  "business.account_ready",
  "business.verification_authorized",
  "business.verification_reminder",
  "business.payment_received",
  "business.platform_live",
  "business.external_account_status",
  "business.founder_welcome",
  "business.first_transaction_reminder",
  "business.account_suspended",
  "business.pin_reset_link",
]);

function resolveCampaignTemplate(campaign: BroadcastCampaign, accountType: string): string {
  const at = String(accountType || "individual").toLowerCase() === "business" ? "business" : "individual";
  if (campaign === "founder_welcome") return `${at}.founder_welcome`;
  if (campaign === "first_transaction_unlock_reminder") return `${at}.first_transaction_reminder`;
  if (campaign === "account_suspended") return `${at}.account_suspended`;
  if (campaign === "pin_reset_link") return `${at}.pin_reset_link`;
  return `${at}.verification_authorized`;
}

function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  let authorized = false;

  // Internal automation path.
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) {
    authorized = true;
  }

  // Admin user path (UI caller).
  if (!authorized && token) {
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    const callerUserId = authData?.user?.id || "";
    if (!authErr && callerUserId) {
      // Accept both admin_users schemas:
      //   - current: user_id + is_active + role
      //   - legacy : id
      // This prevents false unauthorized responses caused by column drift.
      const byUserId = await supabase
        .from("admin_users")
        .select("user_id, is_active, role")
        .eq("user_id", callerUserId)
        .maybeSingle();
      if (byUserId.data?.user_id) {
        const role = String(byUserId.data.role || "").toLowerCase();
        const active = byUserId.data.is_active !== false;
        if (active && (!role || ["admin", "super_admin", "support_admin"].includes(role))) {
          authorized = true;
        }
      }

      if (!authorized) {
        const byLegacyId = await supabase
          .from("admin_users")
          .select("id")
          .eq("id", callerUserId)
          .maybeSingle();
        if (byLegacyId.data?.id) authorized = true;
      }
    }
  }

  if (!authorized) {
    return json({ success: false, error: "Unauthorized — admin access required" }, 401);
  }
  if (!SEND_EMAIL_TOKEN) {
    return json({ success: false, error: "SEND_EMAIL_INTERNAL_TOKEN missing" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid json" }, 400);
  }

  const action = String(body.action || "");
  if (action === "list_recipients") {
    const limit = clampInt(body.limit, 1, 500, 100);
    const search = String(body.search || "").trim().toLowerCase();
    const accountType = String(body.account_type || "all").trim().toLowerCase();

    let q = supabase
      .from("user_profiles")
      .select("id,email,full_name,account_type,bridge_kyc_status,is_unlocked,country,created_at,is_admin")
      .not("email", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (accountType === "individual" || accountType === "business") {
      q = q.eq("account_type", accountType);
    }

    const { data: rows, error } = await q;
    if (error) return json({ success: false, error: error.message }, 500);

    const filtered = (rows || [])
      .filter((r: Record<string, unknown>) => r.is_admin !== true)
      .filter((r: Record<string, unknown>) => {
        if (!search) return true;
        const email = String(r.email || "").toLowerCase();
        const fullName = String(r.full_name || "").toLowerCase();
        return email.includes(search) || fullName.includes(search);
      })
      .map((r: Record<string, unknown>) => ({
        id: String(r.id || ""),
        email: String(r.email || "").toLowerCase(),
        full_name: String(r.full_name || ""),
        account_type: String(r.account_type || "individual").toLowerCase(),
        bridge_kyc_status: String(r.bridge_kyc_status || "not_started").toLowerCase(),
        is_unlocked: Boolean(r.is_unlocked === true),
        country: String(r.country || "").toUpperCase(),
        created_at: String(r.created_at || ""),
      }));

    return json({ success: true, data: { recipients: filtered, total: filtered.length } });
  }

  if (action === "send_campaign") {
    const campaign = String(body.campaign || "").trim() as BroadcastCampaign;
    const supportedCampaigns = new Set<BroadcastCampaign>([
      "founder_welcome",
      "first_transaction_unlock_reminder",
      "account_suspended",
      "verification_reminder",
      "pin_reset_link",
    ]);
    if (!supportedCampaigns.has(campaign)) {
      return json({ success: false, error: "unsupported campaign" }, 400);
    }

    const dryRun = body.dry_run !== false;
    const inputUserIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    const userIds = Array.from(new Set(inputUserIds.map((v) => String(v || "").trim()).filter(Boolean)));
    if (userIds.length === 0) {
      return json({ success: false, error: "user_ids required" }, 400);
    }
    if (userIds.length > 500) {
      return json({ success: false, error: "too many recipients (max 500 per request)" }, 400);
    }

    const { data: profiles, error: profilesErr } = await supabase
      .from("user_profiles")
      .select("id,email,full_name,account_type,is_admin")
      .in("id", userIds);
    if (profilesErr) return json({ success: false, error: profilesErr.message }, 500);

    const activeProfiles = (profiles || []).filter((p: Record<string, unknown>) =>
      p.is_admin !== true && String(p.email || "").includes("@"),
    );

    const bizIds = activeProfiles
      .filter((p: Record<string, unknown>) => String(p.account_type || "").toLowerCase() === "business")
      .map((p: Record<string, unknown>) => String(p.id || ""));
    const bizNameByUser = new Map<string, string>();
    if (bizIds.length > 0) {
      const { data: bizRows } = await supabase
        .from("business_profiles")
        .select("user_id,company_name")
        .in("user_id", bizIds);
      for (const row of bizRows || []) {
        bizNameByUser.set(String((row as Record<string, unknown>).user_id || ""), String((row as Record<string, unknown>).company_name || ""));
      }
    }

    const preview = activeProfiles.map((p: Record<string, unknown>) => ({
      user_id: String(p.id || ""),
      email: String(p.email || "").toLowerCase(),
      account_type: String(p.account_type || "individual").toLowerCase(),
      template: resolveCampaignTemplate(campaign, String(p.account_type || "individual")),
    }));
    if (dryRun) {
      return json({
        success: true,
        data: { dry_run: true, campaign, selected_recipients: activeProfiles.length, preview: preview.slice(0, 100) },
      });
    }

    const campaignProps = (body.props && typeof body.props === "object") ? (body.props as Record<string, unknown>) : {};
    const sent: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    for (const p of activeProfiles) {
      const userId = String((p as Record<string, unknown>).id || "");
      const email = String((p as Record<string, unknown>).email || "").toLowerCase();
      const fullName = String((p as Record<string, unknown>).full_name || "");
      const accountType = String((p as Record<string, unknown>).account_type || "individual").toLowerCase();
      const template = resolveCampaignTemplate(campaign, accountType);
      const isBusiness = accountType === "business";
      const props: Record<string, unknown> = {
        ...campaignProps,
        full_name: fullName,
        action_url: String(campaignProps.action_url || `${Deno.env.get("APP_URL") || "https://app.borderpayafrica.com"}/dashboard`),
      };
      if (campaign === "pin_reset_link") {
        props.reset_url = String(
          campaignProps.reset_url ||
          `${Deno.env.get("APP_URL") || "https://app.borderpayafrica.com"}/forgot-pin`,
        );
      }
      if (isBusiness) {
        props.company_name = String(campaignProps.company_name || bizNameByUser.get(userId) || "Your business");
        if (!("minimum_deposit" in props) && campaign === "first_transaction_unlock_reminder") props.minimum_deposit = "$50";
      } else if (!("minimum_deposit" in props) && campaign === "first_transaction_unlock_reminder") {
        props.minimum_deposit = "$20";
      }
      if (!("stablecoins" in props) && campaign === "first_transaction_unlock_reminder") props.stablecoins = "USDC/USDT";

      try {
        const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
          },
          body: JSON.stringify({
            template,
            to: email,
            user_id: userId,
            idempotency_key: `admin_email_ops:${campaign}:${userId}:${Date.now()}`,
            props,
          }),
        });
        const sendJson = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok) {
          failed.push({ user_id: userId, email, error: (sendJson as Record<string, unknown>).error || `send-email HTTP ${sendRes.status}` });
          continue;
        }
        sent.push({ user_id: userId, email, template });
      } catch (error) {
        failed.push({ user_id: userId, email, error: (error as Error).message });
      }
    }

    return json({
      success: failed.length === 0,
      data: {
        dry_run: false,
        campaign,
        selected_recipients: activeProfiles.length,
        sent_count: sent.length,
        failed_count: failed.length,
        failed,
      },
    }, failed.length === 0 ? 200 : 207);
  }

  if (action === "send_template") {
    const dryRun = body.dry_run !== false;
    const template = String(body.template || "").trim();
    if (!TEMPLATE_ALLOWLIST.has(template)) {
      return json({ success: false, error: "unsupported template" }, 400);
    }
    const inputUserIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    const userIds = Array.from(new Set(inputUserIds.map((v) => String(v || "").trim()).filter(Boolean)));
    if (userIds.length === 0) {
      return json({ success: false, error: "user_ids required" }, 400);
    }
    if (userIds.length > 500) {
      return json({ success: false, error: "too many recipients (max 500 per request)" }, 400);
    }
    const prefix = template.startsWith("business.") ? "business" : template.startsWith("individual.") ? "individual" : null;
    if (!prefix) return json({ success: false, error: "template namespace invalid" }, 400);

    const { data: profiles, error: profilesErr } = await supabase
      .from("user_profiles")
      .select("id,email,full_name,account_type,is_admin")
      .in("id", userIds);
    if (profilesErr) return json({ success: false, error: profilesErr.message }, 500);

    const namespaceProfiles = (profiles || []).filter((p: Record<string, unknown>) =>
      p.is_admin !== true
      && String(p.email || "").includes("@")
      && String(p.account_type || "").toLowerCase() === prefix,
    );

    const bizIds = namespaceProfiles
      .filter((p: Record<string, unknown>) => String(p.account_type || "").toLowerCase() === "business")
      .map((p: Record<string, unknown>) => String(p.id || ""));
    const bizNameByUser = new Map<string, string>();
    if (bizIds.length > 0) {
      const { data: bizRows } = await supabase
        .from("business_profiles")
        .select("user_id,company_name")
        .in("user_id", bizIds);
      for (const row of bizRows || []) {
        bizNameByUser.set(String((row as Record<string, unknown>).user_id || ""), String((row as Record<string, unknown>).company_name || ""));
      }
    }

    const preview = namespaceProfiles.map((p: Record<string, unknown>) => ({
      user_id: String(p.id || ""),
      email: String(p.email || "").toLowerCase(),
      account_type: String(p.account_type || "individual").toLowerCase(),
      template,
    }));
    if (dryRun) {
      return json({
        success: true,
        data: { dry_run: true, template, selected_recipients: namespaceProfiles.length, preview: preview.slice(0, 100) },
      });
    }

    const inputProps = (body.props && typeof body.props === "object") ? (body.props as Record<string, unknown>) : {};
    const sent: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    for (const p of namespaceProfiles) {
      const userId = String((p as Record<string, unknown>).id || "");
      const email = String((p as Record<string, unknown>).email || "").toLowerCase();
      const fullName = String((p as Record<string, unknown>).full_name || "");
      const props: Record<string, unknown> = {
        ...inputProps,
        full_name: inputProps.full_name || fullName,
        action_url: String(inputProps.action_url || `${Deno.env.get("APP_URL") || "https://app.borderpayafrica.com"}/dashboard`),
      };
      if (prefix === "business") {
        props.company_name = String(inputProps.company_name || bizNameByUser.get(userId) || "Your business");
      }

      try {
        const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
          },
          body: JSON.stringify({
            template,
            to: email,
            user_id: userId,
            idempotency_key: `admin_email_ops:template:${template}:${userId}:${Date.now()}`,
            props,
          }),
        });
        const sendJson = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok) {
          failed.push({ user_id: userId, email, error: (sendJson as Record<string, unknown>).error || `send-email HTTP ${sendRes.status}` });
          continue;
        }
        sent.push({ user_id: userId, email, template });
      } catch (error) {
        failed.push({ user_id: userId, email, error: (error as Error).message });
      }
    }

    return json({
      success: failed.length === 0,
      data: {
        dry_run: false,
        template,
        selected_recipients: namespaceProfiles.length,
        sent_count: sent.length,
        failed_count: failed.length,
        failed,
      },
    }, failed.length === 0 ? 200 : 207);
  }

  if (action !== "resend_transaction_email") {
    return json({ success: false, error: "unsupported action" }, 400);
  }

  const userId = String(body.user_id || "").trim();
  const userEmail = String(body.user_email || "").trim().toLowerCase();
  const reference = String(body.reference || "").trim();
  if (!userId && !userEmail) {
    return json({ success: false, error: "user_id or user_email required" }, 400);
  }

  const profileQuery = supabase.from("user_profiles").select("id,email,full_name,account_type");
  const { data: profile, error: profileErr } = userId
    ? await profileQuery.eq("id", userId).maybeSingle()
    : await profileQuery.ilike("email", userEmail).maybeSingle();
  if (profileErr || !profile?.id) {
    return json({ success: false, error: "user profile not found" }, 404);
  }

  let txQuery = supabase
    .from("transactions")
    .select("id,amount,currency,reference,description,created_at")
    .eq("user_id", profile.id)
    .eq("provider", "bridge")
    .order("created_at", { ascending: false })
    .limit(1);
  if (reference) txQuery = txQuery.eq("reference", reference);
  const { data: txRows, error: txErr } = await txQuery;
  if (txErr || !txRows?.length) {
    return json({ success: false, error: "bridge transaction not found for user/reference" }, 404);
  }
  const tx = txRows[0] as Record<string, unknown>;

  const accountType = String(profile.account_type || "individual").toLowerCase();
  const currency = String(tx.currency || "USD").toUpperCase();
  const amount = Number(tx.amount || 0);
  const direction = amount >= 0 ? "credit" : "debit";
  const cleanAmount = Math.abs(amount);
  const txReference = String(tx.reference || "");

  let template = "individual.transaction_notification";
  let props: Record<string, unknown> = {
    full_name: profile.full_name || null,
    direction,
    amount: cleanAmount,
    currency,
    reference: txReference,
    description: tx.description || "Wallet activity",
    occurred_at: tx.created_at || new Date().toISOString(),
  };

  if (accountType === "business") {
    const { data: biz } = await supabase
      .from("business_profiles")
      .select("company_name")
      .eq("user_id", profile.id)
      .maybeSingle();
    template = "business.transaction_notification";
    props = {
      company_name: biz?.company_name || "Your business",
      direction,
      amount: cleanAmount,
      currency,
      reference: txReference,
      description: tx.description || "Wallet activity",
      occurred_at: tx.created_at || new Date().toISOString(),
    };
  }

  const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify({
      template,
      to: String(profile.email || "").toLowerCase(),
      user_id: profile.id,
      idempotency_key: `admin:resend_tx_email:${String(tx.id)}:${Date.now()}`,
      props,
    }),
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    return json({ success: false, error: (sendJson as Record<string, unknown>).error || `send-email HTTP ${sendRes.status}` }, 502);
  }

  return json({
    success: true,
    data: {
      user_id: profile.id,
      email: profile.email,
      transaction_id: tx.id,
      reference: txReference,
      template,
      send_result: sendJson,
    },
  });
});
