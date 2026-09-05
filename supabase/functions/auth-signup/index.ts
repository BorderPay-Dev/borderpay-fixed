// auth-signup v92 — signup creates the app account before hosted verification.
//
// Differences vs v89:
//   • Business signups seed their `business_team_members` owner row directly.
//   • Billing subscriptions are not created at signup. The current internal
//     billing trigger creates `public.subscriptions` after KYC/KYB approval.
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
import { evaluateBusinessEmail } from "../_shared/business-email-policy.ts";
import {
  allowedAccountTypes,
  isSignupFlagEnabled,
  parseSignupAccountType,
  resolveTenantOnboardingPolicy,
  sha256Hex,
  verifyOnboardingToken,
  type OnboardingTokenClaims,
} from "../_shared/onboarding-policy.ts";
import {
  captchaIsRequired,
  extractPublicClientIp,
  readBoundedJson,
} from "../_shared/public-request-security.ts";
import {
  appCheckIsRequired,
  verifyFirebaseAppCheckToken,
} from "../_shared/firebase-app-check.ts";

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
const RECAPTCHA_ENTERPRISE_PROJECT_ID = Deno.env.get("RECAPTCHA_ENTERPRISE_PROJECT_ID") ?? "";
const RECAPTCHA_ENTERPRISE_API_KEY = Deno.env.get("RECAPTCHA_ENTERPRISE_API_KEY") ?? "";
const RECAPTCHA_ENTERPRISE_SITE_KEY = Deno.env.get("RECAPTCHA_ENTERPRISE_SITE_KEY") ?? "";
const RECAPTCHA_MIN_SCORE = Math.min(1, Math.max(0, Number(Deno.env.get("RECAPTCHA_MIN_SCORE") || "0.7")));
const RECAPTCHA_ALLOWED_HOSTNAMES = new Set(
  (Deno.env.get("RECAPTCHA_ALLOWED_HOSTNAMES") || "app.borderpayafrica.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const SIGNUP_CAPTCHA_ACTION = "SIGNUP";

// This is an origin-side pressure valve, not the primary abuse control. Edge
// isolates may be recycled at any time, so the database RPC remains the
// authoritative cross-instance limiter. Keeping a small, bounded cache here
// prevents a hot attacker from forcing a database round trip for every retry.
const EDGE_RATE_WINDOW_MS = 60_000;
const EDGE_RATE_MAX_IP = 12;
const EDGE_RATE_MAX_EMAIL = 4;
const EDGE_RATE_MAX_KEYS = 10_000;
type EdgeRateBucket = { count: number; resetAt: number };
const edgeRateBuckets = new Map<string, EdgeRateBucket>();

function checkEdgeRateLimit(keys: string[], now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
  if (edgeRateBuckets.size > EDGE_RATE_MAX_KEYS) {
    for (const [key, bucket] of edgeRateBuckets) {
      if (bucket.resetAt <= now) edgeRateBuckets.delete(key);
    }
    // Fail safely without allowing attacker-controlled keys to grow memory.
    while (edgeRateBuckets.size > EDGE_RATE_MAX_KEYS) {
      const oldest = edgeRateBuckets.keys().next().value;
      if (typeof oldest !== "string") break;
      edgeRateBuckets.delete(oldest);
    }
  }

  let retryAfter = 0;
  for (const key of keys) {
    const limit = key.startsWith("ip:") ? EDGE_RATE_MAX_IP : EDGE_RATE_MAX_EMAIL;
    const current = edgeRateBuckets.get(key);
    if (current && current.resetAt > now && current.count >= limit) {
      retryAfter = Math.max(retryAfter, Math.ceil((current.resetAt - now) / 1000));
    }
  }
  if (retryAfter > 0) return { allowed: false, retryAfter };

  for (const key of keys) {
    const current = edgeRateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      edgeRateBuckets.set(key, { count: 1, resetAt: now + EDGE_RATE_WINDOW_MS });
    } else {
      current.count += 1;
    }
  }
  return { allowed: true };
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-appcheck",
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
  const enterpriseConfigured = Boolean(
    RECAPTCHA_ENTERPRISE_PROJECT_ID && RECAPTCHA_ENTERPRISE_API_KEY && RECAPTCHA_ENTERPRISE_SITE_KEY,
  );
  if (enterpriseConfigured) {
    if (!token) {
      return captchaIsRequired()
        ? { ok: false, code: "captcha_required", error: "CAPTCHA token is required." }
        : { ok: true };
    }
    try {
      const endpoint = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(RECAPTCHA_ENTERPRISE_PROJECT_ID)}/assessments`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": RECAPTCHA_ENTERPRISE_API_KEY,
        },
        body: JSON.stringify({
          event: {
            token,
            siteKey: RECAPTCHA_ENTERPRISE_SITE_KEY,
            expectedAction: SIGNUP_CAPTCHA_ACTION,
            ...(remoteIp ? { userIpAddress: remoteIp } : {}),
          },
        }),
      });
      const assessment = await response.json().catch(() => ({} as Record<string, unknown>)) as {
        tokenProperties?: { valid?: boolean; hostname?: string; action?: string };
        riskAnalysis?: { score?: number; reasons?: string[] };
      };
      const hostname = String(assessment.tokenProperties?.hostname || "").toLowerCase();
      const action = String(assessment.tokenProperties?.action || "");
      const score = Number(assessment.riskAnalysis?.score ?? -1);
      if (!response.ok || assessment.tokenProperties?.valid !== true) {
        return { ok: false, code: "captcha_failed", error: "CAPTCHA validation failed." };
      }
      if (action !== SIGNUP_CAPTCHA_ACTION || !RECAPTCHA_ALLOWED_HOSTNAMES.has(hostname)) {
        return { ok: false, code: "captcha_context_mismatch", error: "CAPTCHA validation failed." };
      }
      if (!Number.isFinite(score) || score < RECAPTCHA_MIN_SCORE) {
        console.warn(JSON.stringify({ tag: "signup_captcha_risk_denied", score, reasons: assessment.riskAnalysis?.reasons || [] }));
        return { ok: false, code: "captcha_risk_denied", error: "Signup could not be verified. Please retry." };
      }
      return { ok: true };
    } catch {
      return { ok: false, code: "captcha_unavailable", error: "CAPTCHA validation unavailable. Please retry." };
    }
  }

  if (!SIGNUP_CAPTCHA_SECRET) {
    if (captchaIsRequired()) {
      return { ok: false, code: "captcha_not_configured", error: "Signup verification is temporarily unavailable." };
    }
    return { ok: true };
  }
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
  if ((Deno.env.get("SIGNUP_ENABLED") || "true").trim().toLowerCase() === "false") {
    return new Response(
      JSON.stringify({ success: false, code: "signup_temporarily_paused", error: "Signup is temporarily unavailable." }),
      { status: 503, headers: { ...CORS, "Content-Type": "application/json", "Retry-After": "900" } },
    );
  }

  try {
    const envelope = await readBoundedJson<SignupBody>(req);
    if (!envelope.ok) {
      return json({ success: false, code: envelope.code, error: envelope.error }, envelope.status);
    }
    const body = envelope.value;
    const email = String(body?.email || "").trim();
    const captchaToken = String(body?.captcha_token || "").trim();
    const requestIp = extractPublicClientIp(req);
    const ua = req.headers.get("user-agent") || "";

    // Reject cheap invalid input before invoking any database or provider.
    // During the September flood, this ordering is the difference between an
    // inexpensive 4xx response and millions of PostgREST/RPC calls.
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
    const { password, full_name, phone_number, country_code,
            account_type, company_name, registration_number } = body;
    const referralCode = String(body.referral_code || "").trim().toUpperCase();
    const normalizedPhone = String(phone_number || "").trim();
    const onboardingToken = String(body.onboarding_token || "").trim();
    const normalizedCountryCode = String(country_code || "").trim().toUpperCase();

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
    if (normalizedAccountType !== "business" && !onboardingToken) {
      return json({
        success: false,
        code: "business_signup_only",
        error: "BorderPay direct signup is currently available to registered businesses only.",
      }, 403);
    }
    if (normalizedAccountType === "business" && !company_name) {
      return json({ success: false, error: "company_name is required for business accounts" }, 400);
    }
    if (normalizedAccountType === "business") {
      const businessEmail = evaluateBusinessEmail(email, normalizedCountryCode);
      if (!businessEmail.allowed) {
        return json({
          success: false,
          code: "business_email_required",
          error: "Use your company email address (for example, name@company.com). Personal, disposable, and test email domains are not accepted for Business accounts.",
        }, 400);
      }
    }

    // Ukraine has prohibited sub-regions that this country-only form cannot
    // distinguish. Exclude it from self-serve onboarding until a verified
    // address-level screening path exists. Other Bridge High Risk countries
    // remain eligible where Bridge supports enhanced due diligence.
    if (
      !/^[A-Z]{2}$/.test(normalizedCountryCode) ||
      isBridgeBlocked(normalizedCountryCode) ||
      normalizedCountryCode === "UA"
    ) {
      return json({
        success: false,
        code: "country_not_supported",
        error: "BorderPay onboarding is not available in your country yet.",
      }, 403);
    }

    const edgeKeys = [`email:${email.toLowerCase()}`];
    if (requestIp) edgeKeys.push(`ip:${requestIp}`);
    else edgeKeys.push(`client:${ua.slice(0, 160)}:${email.toLowerCase()}`);
    const edgeGate = checkEdgeRateLimit(edgeKeys);
    if (!edgeGate.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "rate_limited",
          error: "Too many signup attempts. Please wait and try again.",
          retry_after_seconds: edgeGate.retryAfter,
        }),
        {
          status: 429,
          headers: { ...CORS, "Content-Type": "application/json", "Retry-After": String(edgeGate.retryAfter) },
        },
      );
    }

    const appCheckToken = (req.headers.get("x-firebase-appcheck") || "").trim();
    let appCheckValid = false;
    if (appCheckToken) {
      if (!await verifyFirebaseAppCheckToken(appCheckToken)) {
        return json({ success: false, code: "app_check_failed", error: "App verification failed." }, 403);
      }
      appCheckValid = true;
    } else if (appCheckIsRequired() && !captchaToken) {
      return json({ success: false, code: "app_check_required", error: "App verification is required." }, 403);
    }

    // Browser CAPTCHA or native App Check precedes all database work.
    const captchaCheck = appCheckValid
      ? { ok: true } as const
      : await verifySignupCaptcha(captchaToken, requestIp);
    if (!captchaCheck.ok) {
      return json({ success: false, code: captchaCheck.code, error: captchaCheck.error }, 400);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Run the IP/email gate before policy lookups and detailed validation.
    // This keeps malformed and rotating-email floods out of business logic.
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

    // Tenant ownership and partner identity are derived exclusively from the
    // verified single-use onboarding token. Reject browser-supplied context
    // instead of silently ignoring it, so conflicting/cross-tenant attempts
    // are observable and cannot be mistaken for authorized onboarding.
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

    if (isBridgeBlocked(normalizedCountryCode)) {
      return json({
        success: false,
        code: "country_not_supported",
        error: "BorderPay is not available in your country yet.",
      }, 403);
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

      const { data: markedAuthorization, error: markError } = await supabaseAdmin
        .from("api_onboarding_authorizations")
        .update({ used_by_user_id: userId })
        .eq("id", partnerAuthorization.authorization_id)
        .is("used_by_user_id", null)
        .select("id")
        .maybeSingle();
      if (markError || !markedAuthorization?.id) {
        return rollbackAuthUser(`authorization completion failed: ${markError?.message || "authorization was not updated"}`);
      }

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

      // Team ownership is an account-creation invariant, independent from the
      // billing lifecycle. The current billing model does not create a
      // public.subscriptions row until the business passes verification.
      const { error: ownerMembershipError } = await supabaseAdmin
        .from("business_team_members")
        .insert({
          business_user_id: userId,
          member_user_id: userId,
          invited_email: email,
          role: "owner",
          status: "active",
          joined_at: new Date().toISOString(),
          invited_by: userId,
        });
      if (ownerMembershipError) {
        return rollbackAuthUser(`business owner membership failed: ${ownerMembershipError.message}`);
      }
    }
    if (partnerAuthorization) {
      const { error: completionAuditError } = await supabaseAdmin.from("api_onboarding_audit").insert({
        tenant_id: partnerAuthorization.tenant_id,
        api_key_id: partnerAuthorization.api_key_id,
        authorization_id: partnerAuthorization.authorization_id,
        user_id: userId,
        external_user_id: partnerAuthorization.external_user_id,
        event_type: "signup_completed",
        account_type: normalizedAccountType,
        onboarding_channel: partnerAuthorization.onboarding_channel,
      });
      if (completionAuditError) {
        return rollbackAuthUser(`signup completion audit failed: ${completionAuditError.message}`);
      }
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
    // before identity creation. No rollback-prone database step follows this
    // insert, and existing accounts are intentionally never backfilled.
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
    if (originError) {
      return rollbackAuthUser(`account origin provenance insert failed: ${originError.message}`);
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
          tenant_id:       partnerAuthorization?.onboarding_channel === "white_label" ? partnerAuthorization.tenant_id : undefined,
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
