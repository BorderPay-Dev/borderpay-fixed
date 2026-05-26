// auth-signup v90 — provider-neutral signup with subscription scaffold.
//
// Differences vs v89:
//   • After core rows persist, calls `ensure_starter_subscription(userId,
//     account_type)` to seed a free-tier `user_subscriptions` row
//     (individual_starter / business_starter). Business signups also get a
//     seed row in `business_team_members` with role='owner', status='active'.
//   • All other behaviour identical to v89: no Bridge customer creation,
//     no legacy provider customer creation, verification email + token
//     semantics unchanged.
//
// Deploy:
//   supabase functions deploy auth-signup --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL               = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";

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
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json()) as SignupBody;
    const { email, password, full_name, phone_number, country_code,
            account_type, company_name, registration_number } = body;

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
    // Provider-neutral: NO provider customer creation here.
    // Bridge customer creation happens later, only when the user clicks
    // Start KYC/KYB (bridge-customer + bridge-kyc-link / bridge-kyb-link).
    {
      // Columns must match the current public.users schema exactly. The
      // legacy fields (is_unlocked / one_time_fee_paid / is_kyc_verified /
      // beta_user) were dropped with the Maplerad removal and writing to
      // them causes "column does not exist". `kyc_status` is an enum —
      // valid values are: unverified | pending | verified | failed |
      // approved | rejected. Use `unverified` for new accounts.
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
    const xff = req.headers.get("x-forwarded-for") || "";
    const ua  = req.headers.get("user-agent") || "";
    const { data: tokenData, error: tokenErr } = await supabaseAdmin.rpc("issue_email_token", {
      p_user_id:     userId,
      p_purpose:     tokenPurpose,
      p_ttl_minutes: 60 * 24,
      p_ip:          xff.split(",")[0]?.trim() || null,
      p_ua:          ua,
    });
    if (tokenErr || !tokenData) {
      return rollbackAuthUser(`token issue failed: ${tokenErr?.message || "no token"}`);
    }
    const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(tokenData)}&purpose=${tokenPurpose}`;

    // ── Send the verification email via the live send-confirmation-email function ──
    //
    // P0 hotfix: this code path previously POSTed to `/functions/v1/send-email`.
    // The unified `send-email` function exists in local source but is NOT
    // deployed — production was running a patched v99 of this edge function
    // which had already been switched to `send-confirmation-email`. Local
    // source on main is now reconciled with that production behaviour, so a
    // future `supabase functions deploy auth-signup` from this repo no longer
    // regresses welcome / verification email delivery.
    //
    // If/when the unified `send-email` (multi-template, email_log writes,
    // idempotency) is deployed, this function and `auth-resend-verification`
    // can be switched in lockstep.
    try {
      const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-confirmation-email`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        },
        body: JSON.stringify({
          email,
          full_name,
          confirmation_url: verifyUrl,
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
              bridge_customer_id: null,
              email_verified:     false,
            },
            email_sent:  false,
            email_error: (sendJson as any)?.error || `send-confirmation-email HTTP ${sendRes.status}`,
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
            bridge_customer_id: null,
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
          bridge_customer_id: null,
          email_verified:     false,
        },
        email_sent:   true,
        access_token: "",
      },
    });
  } catch (err) {
    return json({ success: false, error: (err as Error).message || "Internal server error" }, 500);
  }
});
