// auth-signup v91 — signup with immediate Bridge customer identity creation.
//
// Differences vs v90:
//   • Creates Bridge customer via Customers API during signup and persists
//     bridge_customer_id immediately (user_profiles and business_profiles).
//   • After core rows persist, calls `ensure_starter_subscription(userId,
//     account_type)` to seed a free-tier `user_subscriptions` row
//     (individual_starter / business_starter). Business signups also get a
//     seed row in `business_team_members` with role='owner', status='active'.
//   • Verification email + token semantics unchanged.
//
// Deploy:
//   supabase functions deploy auth-signup --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
// Service-role: used ONLY for the admin client (createUser + table upserts).
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Internal token for authenticating to send-email (NOT the service-role key).
const SEND_EMAIL_TOKEN      = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL               = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";
const SIGNUP_CAPTCHA_SECRET = Deno.env.get("SIGNUP_CAPTCHA_SECRET") ?? "";
const SIGNUP_CAPTCHA_VERIFY_URL =
  Deno.env.get("SIGNUP_CAPTCHA_VERIFY_URL") ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

interface SignupBody {
  email:                string;
  password:             string;
  full_name:            string;
  phone_number?:        string;
  country_code?:        string;
  account_type?:        "individual" | "business";
  company_name?:        string;
  registration_number?: string;
  captcha_token?:       string;
}

async function verifySignupCaptcha(
  token: string,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  if (!SIGNUP_CAPTCHA_SECRET) return { ok: true };
  if (!token) {
    return { ok: false, code: "captcha_required", error: "CAPTCHA token is required." };
  }
  try {
    const payload = new URLSearchParams();
    payload.set("secret", SIGNUP_CAPTCHA_SECRET);
    payload.set("response", token);
    if (remoteIp) payload.set("remoteip", remoteIp);

    const resp = await fetch(SIGNUP_CAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
    });
    const data = await resp.json().catch(() => ({} as Record<string, unknown>));
    if (!resp.ok || data?.success !== true) {
      return { ok: false, code: "captcha_failed", error: "CAPTCHA validation failed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "captcha_unavailable", error: "CAPTCHA validation unavailable. Please retry." };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  try {
    const body = (await req.json()) as SignupBody;
    const { email, password, full_name, phone_number, country_code,
            account_type, company_name, registration_number, captcha_token } = body;

    if (!email || !password || !full_name) {
      return json({ success: false, error: "Email, password, and full name are required" }, 400);
    }

    const normalizedAccountType: "individual" | "business" =
      account_type === "business" ? "business" : "individual";
    if (normalizedAccountType === "business" && !company_name) {
      return json({ success: false, error: "company_name is required for business accounts" }, 400);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const xff = req.headers.get("x-forwarded-for") || "";
    const requestIp = xff.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || "";

    // Abuse gate (rate-limit + cooldown) before any auth row is created.
    const { data: abuseGate, error: abuseErr } = await supabaseAdmin.rpc("enforce_signup_abuse_protection", {
      p_email:      email,
      p_ip:         requestIp,
      p_user_agent: ua,
    });
    if (abuseErr) {
      const m = String(abuseErr.message || "");
      // Fail-open only for migration/schema drift where the RPC does not exist
      // in this environment. Other abuse-gate failures remain fail-closed.
      if (!/could not find the function public\.enforce_signup_abuse_protection/i.test(m)) {
        return json({ success: false, error: `Signup protection check failed: ${m}` }, 500);
      }
      console.warn(`auth-signup abuse gate RPC missing; continuing without gate for this request: ${m}`);
    }
    const abuse = Array.isArray(abuseGate) ? abuseGate[0] : abuseGate;
    if (!abuse?.allowed) {
      const retryAfter = Number(abuse?.retry_after_seconds || 30);
      return new Response(
        JSON.stringify({
          success: false,
          code: abuse?.code || "rate_limited",
          error: "Too many signup attempts. Please wait and try again.",
          retry_after_seconds: retryAfter,
        }),
        {
          status: 429,
          headers: { ...CORS, "Content-Type": "application/json", "Retry-After": String(Math.max(1, retryAfter)) },
        },
      );
    }

    // CAPTCHA hook. When SIGNUP_CAPTCHA_SECRET is configured this fails-closed.
    const captchaCheck = await verifySignupCaptcha(String(captcha_token || "").trim(), requestIp);
    if (!captchaCheck.ok) {
      return json({ success: false, code: captchaCheck.code, error: captchaCheck.error }, 400);
    }

    // ── Create the auth user UNCONFIRMED ─────────────────────────────────
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,                     // ← critical change vs v87
      user_metadata: {
        full_name,
        phone:        phone_number,
        country:      country_code,
        account_type: normalizedAccountType,
        ...(normalizedAccountType === "business"
          ? { company_name, registration_number: registration_number || null }
          : {}),
      },
    });

    if (authError) {
      const msg = authError.message.includes("already registered")
        ? "An account with this email already exists"
        : authError.message;
      return json({ success: false, error: msg }, 400);
    }

    const userId = authData.user!.id;

    const rollbackAuthUser = async (reason: string) => {
      try { await supabaseAdmin.auth.admin.deleteUser(userId); } catch { /* best effort */ }
      return json({ success: false, error: reason }, 500);
    };

    // ── Persist legacy users + canonical user_profiles, atomically ───────
    {
      // Columns must match the current public.users schema exactly. Legacy
      // onboarding/payment fields were dropped; writing to them causes
      // "column does not exist". `kyc_status` is an enum — valid values are:
      // unverified | pending | verified | failed | approved | rejected.
      // Use `unverified` for new accounts.
      const { error: usersErr } = await supabaseAdmin.from("users").upsert({
        id: userId, email, full_name,
        phone:            phone_number || "",
        country:          country_code || "",
        account_type:     normalizedAccountType,
        kyc_status:       "unverified",
        wallet_activated: false,
      });
      if (usersErr) return rollbackAuthUser(`users upsert failed: ${usersErr.message}`);
    }
    {
      // Same enum rule for user_profiles.kyc_status. address_verification_status
      // is a free-form text column so 'not_started' is fine there.
      const { error: profileErr } = await supabaseAdmin.from("user_profiles").upsert({
        id: userId, email, full_name,
        phone:                       phone_number || "",
        country:                     country_code || "",
        account_type:                normalizedAccountType,
        kyc_status:                  "unverified",
        kyc_level:                   0,
        language:                    "en",
        address_verification_status: "not_started",
        bridge_customer_id:          null,
        bridge_kyc_status:           "not_started",
      });
      if (profileErr) return rollbackAuthUser(`user_profiles upsert failed: ${profileErr.message}`);
    }
    {
      const [{ data: uRow }, { data: pRow }] = await Promise.all([
        supabaseAdmin.from("users").select("id").eq("id", userId).maybeSingle(),
        supabaseAdmin.from("user_profiles").select("id").eq("id", userId).maybeSingle(),
      ]);
      if (!uRow || !pRow) {
        return rollbackAuthUser(
          `profile rows missing after upsert (users=${!!uRow} user_profiles=${!!pRow})`,
        );
      }
    }
    if (normalizedAccountType === "business") {
      const { error: bizErr } = await supabaseAdmin.from("business_profiles").upsert(
        {
          user_id:             userId,
          company_name:        company_name!,
          registration_number: registration_number || null,
          country:             (country_code || "NG").toUpperCase(),
          status:              "active",
          bridge_customer_id:  null,
          bridge_kyb_status:   "not_started",
        },
        { onConflict: "user_id" },
      );
      if (bizErr) return rollbackAuthUser(`business_profiles create failed: ${bizErr.message}`);
    }

    // ── Create Bridge customer identity at signup (Customers API) ─────────
    // Best effort: signup must remain available even if provider identity
    // creation is temporarily unavailable. KYC/KYB start paths and sync jobs
    // can provision bridge_customer_id later.
    let bridgeCustomerId: string | null = null;
    let bridgeCustomerProvisioningError: string | null = null;
    try {
      const createdCustomer = await bridgeProvider.createCustomer({
        account_type: normalizedAccountType,
        email,
        full_name: full_name || undefined,
        company_name: normalizedAccountType === "business" ? (company_name || undefined) : undefined,
        registration_number: normalizedAccountType === "business" ? (registration_number || undefined) : undefined,
        country_code: (country_code || "NG").toUpperCase(),
        phone_e164: phone_number || undefined,
        borderpay_user_id: userId,
      });
      bridgeCustomerId = createdCustomer.provider_id;
    } catch (e) {
      bridgeCustomerProvisioningError = (e as Error).message;
      console.warn(`auth-signup bridge customer create failed for ${userId}: ${bridgeCustomerProvisioningError}`);
    }

    if (bridgeCustomerId) {
      const { error: bridgeUserErr } = await supabaseAdmin.from("user_profiles").update({
        bridge_customer_id: bridgeCustomerId,
        bridge_kyc_status: "not_started",
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      if (bridgeUserErr) return rollbackAuthUser(`user_profiles bridge sync failed: ${bridgeUserErr.message}`);
    }

    if (normalizedAccountType === "business" && bridgeCustomerId) {
      const { error: bridgeBizErr } = await supabaseAdmin.from("business_profiles").update({
        bridge_customer_id: bridgeCustomerId,
        bridge_kyb_status: "not_started",
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId);
      if (bridgeBizErr) return rollbackAuthUser(`business_profiles bridge sync failed: ${bridgeBizErr.message}`);
    }

    // ── Seed the free-tier subscription + owner team-membership ────────
    // Failure here is non-fatal for signup itself — the user gets a verified
    // account but lands with no subscription row. We log and continue; a
    // background reaper / admin tool can backfill.
    try {
      await supabaseAdmin.rpc("ensure_starter_subscription", {
        p_user_id:      userId,
        p_account_type: normalizedAccountType,
      });
    } catch (e) {
      // Best-effort log; do not roll back the user for a subscription seed failure.
      console.warn(`ensure_starter_subscription failed for ${userId}: ${(e as Error).message}`);
    }

    // ── Issue a verification token ────────────────────────────────────────
    const tokenPurpose = normalizedAccountType === "business" ? "signup_business" : "signup_individual";
    const { data: tokenData, error: tokenErr } = await supabaseAdmin.rpc("issue_email_token", {
      p_user_id:     userId,
      p_purpose:     tokenPurpose,
      p_ttl_minutes: 60 * 24,
      p_ip:          requestIp,
      p_ua:          ua,
    });
    if (tokenErr || !tokenData) {
      return rollbackAuthUser(`token issue failed: ${tokenErr?.message || "no token"}`);
    }
    const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(tokenData)}&purpose=${tokenPurpose}`;

    // ── Send the verification email via the LOGGED `send-email` path ──
    //
    // Email P0: route through the unified `send-email` function, which writes
    // public.email_log BEFORE calling Resend (via the log_email_attempt RPC),
    // recording status queued/sending/sent/failed, the Resend message id, error
    // body, attempts, and an idempotency key. Replaces the unlogged
    // `send-confirmation-email` path so email delivery is observable.
    //
    // Auth: send-email is gated by the dedicated SEND_EMAIL_INTERNAL_TOKEN
    // (NOT the service-role key). send-email MUST be deployed BEFORE this
    // function, else the call 404s. Behaviour preserved: signup still
    // succeeds if the send fails (email_sent:false + email_error), UI shows the
    // pending-email + resend state.
    //
    // Template chosen by account type; verification_url is the template prop.
    const emailTemplate = normalizedAccountType === "business"
      ? "business.email_verification"
      : "individual.email_verification";
    try {
      const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
        },
        body: JSON.stringify({
          template:        emailTemplate,
          to:              email,
          user_id:         userId,
          idempotency_key: `verify:${userId}:${tokenPurpose}`,
          props: {
            full_name,
            verification_url: verifyUrl,
          },
        }),
      });
      const sendJson = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok || !(sendJson as any)?.success) {
        // Verification email failed — but the user CAN request a resend
        // via auth-resend-verification. Don't roll back the user here.
        return json({
          success: true,
          data: {
            user: {
              id: userId, email, full_name,
            account_type:       normalizedAccountType,
            kyc_status:         "not_started",
            bridge_customer_id: bridgeCustomerId,
            bridge_customer_provisioning_pending: bridgeCustomerId === null,
            email_verified:     false,
          },
          email_sent:  false,
          email_error: (sendJson as any)?.error || `send-email HTTP ${sendRes.status}`,
          bridge_customer_provisioning_error: bridgeCustomerProvisioningError,
          access_token: "",
        },
      });
      }
    } catch (e) {
      return json({
        success: true,
        data: {
          user: {
            id: userId, email, full_name,
            account_type:       normalizedAccountType,
            kyc_status:         "not_started",
            bridge_customer_id: bridgeCustomerId,
            bridge_customer_provisioning_pending: bridgeCustomerId === null,
            email_verified:     false,
          },
          email_sent:  false,
          email_error: (e as Error).message,
          bridge_customer_provisioning_error: bridgeCustomerProvisioningError,
          access_token: "",
        },
      });
    }

    return json({
      success: true,
      data: {
        user: {
          id: userId, email, full_name,
          account_type:       normalizedAccountType,
          kyc_status:         "not_started",
          bridge_customer_id: bridgeCustomerId,
          bridge_customer_provisioning_pending: bridgeCustomerId === null,
          email_verified:     false,
        },
        email_sent:   true,
        bridge_customer_provisioning_error: bridgeCustomerProvisioningError,
        access_token: "",
      },
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message || "Internal server error" }, 500);
  }
});
