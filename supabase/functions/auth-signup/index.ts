// auth-signup v92 — signup creates the app account before hosted verification.
//
// Differences vs v89:
//   • After core rows persist, calls `ensure_starter_subscription(userId,
//     account_type)` to seed a free-tier `user_subscriptions` row
//     (individual_starter / business_starter). Business signups also get a
//     seed row in `business_team_members` with role='owner', status='active'.
//   • Country compliance is checked at signup, but provider customer creation
//     stays in the hosted KYC/KYB flow. Creating a provider customer here is
//     incompatible with the minimal fields collected on signup and can block
//     valid users before email verification.
//
// Deploy:
//   supabase functions deploy auth-signup --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isBridgeBlocked } from "../_shared/providers/bridge-country-policy.ts";
import {
  allowedAccountTypes,
  isSignupFlagEnabled,
  parseSignupAccountType,
  resolveTenantOnboardingPolicy,
  sha256Hex,
  verifyOnboardingToken,
  type OnboardingTokenClaims,
} from "../_shared/onboarding-policy.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
// Service-role: used ONLY for the admin client (createUser + table upserts).
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Internal token for authenticating to send-email (NOT the service-role key).
const SEND_EMAIL_TOKEN      = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL               = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";
const SIGNUP_CAPTCHA_SECRET = Deno.env.get("SIGNUP_CAPTCHA_SECRET") ?? "";
const ONBOARDING_TOKEN_SIGNING_SECRET = Deno.env.get("ONBOARDING_TOKEN_SIGNING_SECRET") ?? "";
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
  referral_code?:       string;
  onboarding_token?:    string;
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
    // Tenant ownership and partner identity are derived exclusively from the
    // verified single-use onboarding token. Reject browser-supplied context
    // instead of silently ignoring it, so conflicting/cross-tenant attempts
    // are observable and cannot be mistaken for authorized onboarding.
    if (
      Object.prototype.hasOwnProperty.call(body, "tenant_id") ||
      Object.prototype.hasOwnProperty.call(body, "external_user_id") ||
      Object.prototype.hasOwnProperty.call(body, "onboarding_channel")
    ) {
      return json({
        success: false,
        code: "untrusted_onboarding_context",
        error: "Tenant onboarding context must come from a signed authorization token.",
      }, 403);
    }
    const { email, password, full_name, phone_number, country_code,
            account_type, company_name, registration_number, captcha_token } = body;
    const referralCode = String(body.referral_code || "").trim().toUpperCase();
    const normalizedPhone = String(phone_number || "").trim();
    const onboardingToken = String(body.onboarding_token || "").trim();

    if (!email || !password || !full_name) {
      return json({ success: false, error: "Email, password, and full name are required" }, 400);
    }

    const parsedAccountType = parseSignupAccountType(account_type);
    if (!parsedAccountType) {
      return json({
        success: false,
        code: "account_type_required",
        error: "Select an allowed account type before continuing.",
      }, 400);
    }
    const normalizedAccountType: "individual" | "business" = parsedAccountType;
    if (normalizedAccountType === "business" && !company_name) {
      return json({ success: false, error: "company_name is required for business accounts" }, 400);
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let partnerClaims: OnboardingTokenClaims | null = null;
    let partnerAuthorization: {
      authorization_id: string;
      tenant_id: string;
      api_key_id: string;
      external_user_id: string;
      onboarding_channel: "api" | "white_label";
    } | null = null;

    if (onboardingToken) {
      try {
        partnerClaims = await verifyOnboardingToken(
          onboardingToken,
          ONBOARDING_TOKEN_SIGNING_SECRET,
        );
      } catch (error) {
        return json({
          success: false,
          code: "invalid_onboarding_authorization",
          error: "This signup link is invalid or expired.",
        }, 403);
      }
      if (!partnerClaims.allowed_account_types.includes(normalizedAccountType)) {
        return json({
          success: false,
          code: "account_type_not_authorized",
          error: "The selected account type is not available for this signup link.",
        }, 403);
      }

      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("api_tenants")
        .select("id, is_active, metadata")
        .eq("id", partnerClaims.tenant_id)
        .maybeSingle();
      if (tenantError || !tenant?.is_active) {
        return json({ success: false, code: "tenant_not_authorized", error: "This signup link is no longer active." }, 403);
      }
      const currentPolicy = resolveTenantOnboardingPolicy(tenant.metadata);
      if (!allowedAccountTypes(currentPolicy, partnerClaims.onboarding_channel).includes(normalizedAccountType)) {
        return json({
          success: false,
          code: "account_type_not_authorized",
          error: "The selected account type is no longer available for this signup link.",
        }, 403);
      }
    } else {
      const policyKey = normalizedAccountType === "individual"
        ? "direct_individual_signup_enabled"
        : "direct_business_signup_enabled";
      const { data: directPolicy } = await supabaseAdmin
        .from("app_config")
        .select("value")
        .eq("key", policyKey)
        .maybeSingle();
      if (!isSignupFlagEnabled(directPolicy?.value)) {
        return json({
          success: false,
          code: normalizedAccountType === "individual"
            ? "individual_signup_unavailable"
            : "business_signup_unavailable",
          error: normalizedAccountType === "individual"
            ? "New Individual signup is not available in this BorderPay app. Create a Business account instead."
            : "New business signup is temporarily unavailable.",
        }, 403);
      }
    }

    const normalizedCountryCode = String(country_code || "NG").trim().toUpperCase();
    if (isBridgeBlocked(normalizedCountryCode)) {
      return json({
        success: false,
        code: "country_not_supported",
        error: "BorderPay is not available in your country yet.",
      }, 403);
    }

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
      return json({ success: false, error: `Signup protection check failed: ${abuseErr.message}` }, 500);
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

    // Reserve the partner authorization atomically only after abuse and CAPTCHA
    // checks pass, but before any Auth identity is created.
    if (partnerClaims) {
      const tokenHash = await sha256Hex(onboardingToken);
      const { data: consumed, error: consumeError } = await supabaseAdmin.rpc(
        "consume_api_onboarding_authorization",
        { p_token_hash: tokenHash, p_account_type: normalizedAccountType },
      );
      const row = Array.isArray(consumed) ? consumed[0] : consumed;
      if (consumeError || !row ||
        String(row.authorization_id) !== partnerClaims.jti ||
        String(row.tenant_id) !== partnerClaims.tenant_id ||
        String(row.api_key_id) !== partnerClaims.api_key_id ||
        String(row.external_user_id) !== partnerClaims.external_user_id ||
        String(row.onboarding_channel) !== partnerClaims.onboarding_channel) {
        return json({
          success: false,
          code: "onboarding_authorization_unavailable",
          error: "This signup link is invalid, expired, or has already been used.",
        }, 403);
      }
      partnerAuthorization = {
        authorization_id: String(row.authorization_id),
        tenant_id: String(row.tenant_id),
        api_key_id: String(row.api_key_id),
        external_user_id: String(row.external_user_id),
        onboarding_channel: String(row.onboarding_channel) as "api" | "white_label",
      };
    }

    // ── Create the auth user UNCONFIRMED ─────────────────────────────────
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,                     // ← critical change vs v87
      user_metadata: {
        full_name,
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        country:      country_code,
        account_type: normalizedAccountType,
        ...(partnerAuthorization
          ? {
              onboarding_tenant_id: partnerAuthorization.tenant_id,
              onboarding_channel: partnerAuthorization.onboarding_channel,
              external_user_id: partnerAuthorization.external_user_id,
            }
          : { onboarding_channel: "direct" }),
        ...(referralCode ? { referral_code: referralCode } : {}),
        ...(normalizedAccountType === "business"
          ? { company_name, registration_number: registration_number || null }
          : {}),
      },
    });

    if (authError) {
      if (partnerAuthorization) {
        await supabaseAdmin.from("api_onboarding_audit").insert({
          tenant_id: partnerAuthorization.tenant_id,
          api_key_id: partnerAuthorization.api_key_id,
          authorization_id: partnerAuthorization.authorization_id,
          external_user_id: partnerAuthorization.external_user_id,
          event_type: "signup_failed",
          account_type: normalizedAccountType,
          onboarding_channel: partnerAuthorization.onboarding_channel,
          metadata: { stage: "auth_create", reason: authError.message },
        });
      }
      const msg = authError.message.includes("already registered")
        ? "An account with this email already exists"
        : authError.message;
      return json({ success: false, error: msg }, 400);
    }

    const userId = authData.user!.id;

    const rollbackAuthUser = async (reason: string) => {
      if (partnerAuthorization) {
        await supabaseAdmin.from("api_onboarding_audit").insert({
          tenant_id: partnerAuthorization.tenant_id,
          api_key_id: partnerAuthorization.api_key_id,
          authorization_id: partnerAuthorization.authorization_id,
          user_id: userId,
          external_user_id: partnerAuthorization.external_user_id,
          event_type: "signup_failed",
          account_type: normalizedAccountType,
          onboarding_channel: partnerAuthorization.onboarding_channel,
          metadata: { stage: "persistence", reason },
        });
      }
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
        phone:            normalizedPhone,
        country:          normalizedCountryCode,
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
        phone:                       normalizedPhone,
        country:                     normalizedCountryCode,
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
    if (partnerAuthorization) {
      const { error: mappingError } = await supabaseAdmin.from("api_tenant_end_users").insert({
        tenant_id: partnerAuthorization.tenant_id,
        user_id: userId,
        external_user_id: partnerAuthorization.external_user_id,
        account_type: normalizedAccountType,
        onboarding_channel: partnerAuthorization.onboarding_channel,
      });
      if (mappingError) return rollbackAuthUser(`tenant user mapping failed: ${mappingError.message}`);

      const { error: markError } = await supabaseAdmin
        .from("api_onboarding_authorizations")
        .update({ used_by_user_id: userId })
        .eq("id", partnerAuthorization.authorization_id)
        .is("used_by_user_id", null);
      if (markError) return rollbackAuthUser(`authorization completion failed: ${markError.message}`);

    }
    if (normalizedAccountType === "business") {
      const { error: bizErr } = await supabaseAdmin.from("business_profiles").upsert(
        {
          user_id:             userId,
          company_name:        company_name!,
          registration_number: registration_number || null,
          country:             normalizedCountryCode,
          status:              "active",
          bridge_customer_id:  null,
          bridge_kyb_status:   "not_started",
        },
        { onConflict: "user_id" },
      );
      if (bizErr) return rollbackAuthUser(`business_profiles create failed: ${bizErr.message}`);
    }
    if (referralCode) {
      try {
        const { data: referralResult, error: referralErr } = await supabaseAdmin.rpc(
          "track_borderpay_referral_signup",
          {
            p_referral_code: referralCode,
            p_referred_id: userId,
            p_country: normalizedCountryCode,
            p_device_hash: null,
            p_ip_hash: null,
          },
        );
        if (referralErr) {
          console.warn(`referral attribution failed for ${userId}: ${referralErr.message}`);
        } else {
          console.log(JSON.stringify({
            tag: "referral_attribution_result",
            user_id: userId,
            referral_code: referralCode,
            result: Array.isArray(referralResult) ? referralResult[0] : referralResult,
          }));
        }
      } catch (e) {
        console.warn(`referral attribution exception for ${userId}: ${(e as Error).message}`);
      }
    }

    const bridgeCustomerId: string | null = null;

    // ── Seed the free-tier subscription + owner team-membership ────────
    // This is part of account creation, not a best-effort side effect. The
    // Supabase client reports RPC failures in its returned `error` field (it
    // does not throw), so ignoring the result can leave a successful signup
    // without the required subscription/owner records.
    const { error: starterSubscriptionError } = await supabaseAdmin.rpc(
      "ensure_starter_subscription",
      {
        p_user_id:      userId,
        p_account_type: normalizedAccountType,
      },
    );
    if (starterSubscriptionError) {
      return rollbackAuthUser(
        `starter subscription failed: ${starterSubscriptionError.message}`,
      );
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
    // Immutable server-owned provenance is the final fail-closed persistence
    // step. Values come only from the policy decision and consumed partner
    // authorization; browser tenant/channel/external-user fields were rejected
    // before identity creation. No rollback-prone step follows this insert.
    const { error: originError } = await supabaseAdmin.from("account_origin_provenance").insert({
      user_id:            userId,
      account_type:       normalizedAccountType,
      origin_kind:        partnerAuthorization ? "partner" : "direct",
      onboarding_channel: partnerAuthorization?.onboarding_channel || "direct",
      source_path:        "supabase/functions/auth-signup",
      account_created_at: authData.user!.created_at,
      tenant_id:          partnerAuthorization?.tenant_id || null,
      api_key_id:         partnerAuthorization?.api_key_id || null,
      authorization_id:   partnerAuthorization?.authorization_id || null,
      external_user_id:   partnerAuthorization?.external_user_id || null,
      source_reference:   partnerAuthorization?.authorization_id || null,
    });
    if (originError) return rollbackAuthUser(`account origin provenance insert failed: ${originError.message}`);

    if (partnerAuthorization) {
      await supabaseAdmin.from("api_onboarding_audit").insert({
        tenant_id: partnerAuthorization.tenant_id,
        api_key_id: partnerAuthorization.api_key_id,
        authorization_id: partnerAuthorization.authorization_id,
        user_id: userId,
        external_user_id: partnerAuthorization.external_user_id,
        event_type: "signup_completed",
        account_type: normalizedAccountType,
        onboarding_channel: partnerAuthorization.onboarding_channel,
      });
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
              email_verified:     false,
            },
            email_sent:  false,
            email_error: (sendJson as any)?.error || `send-email HTTP ${sendRes.status}`,
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
            email_verified:     false,
          },
          email_sent:  false,
          email_error: (e as Error).message,
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
          email_verified:     false,
        },
        email_sent:   true,
        access_token: "",
      },
    });
  } catch (err) {
    const raw = String((err as Error)?.message || "");
    const normalized = raw.toLowerCase();
    let userMessage = "We couldn't create your account right now. Please try again in a few moments.";
    if (normalized.includes("already registered") || normalized.includes("already exists")) {
      userMessage = "An account with this email already exists. Please sign in instead.";
    } else if (normalized.includes("captcha")) {
      userMessage = "CAPTCHA validation failed. Please retry and complete the verification.";
    } else if (normalized.includes("password")) {
      userMessage = "Your password doesn't meet security requirements. Please use a stronger password.";
    } else if (normalized.includes("email")) {
      userMessage = "Please enter a valid email address and try again.";
    }
    console.error("auth-signup unhandled error", { message: raw });
    return json({ success: false, error: userMessage }, 500);
  }
});
