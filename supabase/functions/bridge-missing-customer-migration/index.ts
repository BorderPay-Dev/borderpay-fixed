import { bridgeOnboardingEnabled, bridgeOnboardingPausedBody } from "../_shared/launch-gates.ts";
// bridge-missing-customer-migration
//
// Operator-only repair for email-confirmed users that have no Bridge customer
// id. Unconfirmed users get a fresh verification email instead. This calls
// Bridge only for email-confirmed users; it never writes fake provider ids.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import {
  bridgeCountryBlockResponse,
  isBridgeBlocked,
  logControlledBridgeTraffic,
} from "../_shared/providers/bridge-country-policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i += 1) out |= aa[i] ^ bb[i];
  return out === 0;
}

function hasServiceRoleClaim(token: string): boolean {
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function shouldLinkExistingBridgeCustomer(error: unknown): boolean {
  const raw = String((error as any)?.raw_text || "").toLowerCase();
  const msg = `${String((error as any)?.bridge_code || "")} ${String((error as any)?.bridge_error || "")} ${String((error as Error)?.message || "")}`.toLowerCase();
  return (
    raw.includes("a customer with this email already exists") ||
    raw.includes("idempotency key retry deadline exceeded") ||
    msg.includes("idempotency key retry deadline exceeded")
  );
}

async function linkExistingBridgeCustomer(profile: any, normalizedEmail: string) {
  const existing = await bridgeProvider.findCustomerByEmail(profile.email || normalizedEmail);
  if (!existing?.id) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "error",
      reason: "existing_bridge_customer_not_found_by_email",
    };
  }

  const canonical = await bridgeProvider.getCustomerProfile(existing.id);
  const raw = (canonical.raw as any)?.data ?? canonical.raw ?? {};
  const bridgeEmail = String(raw?.email ?? raw?.business_email ?? raw?.customer_email ?? "").trim().toLowerCase();
  if (bridgeEmail && bridgeEmail !== normalizedEmail) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "error",
      reason: "existing_bridge_customer_email_mismatch",
      bridge_customer_id: existing.id,
      bridge_email: bridgeEmail,
    };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("user_profiles")
    .update({
      bridge_customer_id: existing.id,
      bridge_kyc_status: "not_started",
      updated_at: now,
    })
    .eq("id", profile.id);
  if (updateErr) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "error",
      reason: `existing_bridge_customer_profile_update_failed: ${updateErr.message}`,
      bridge_customer_id: existing.id,
    };
  }

  if (profile.account_type === "business") {
    await supabase
      .from("business_profiles")
      .update({ bridge_customer_id: existing.id, updated_at: now })
      .eq("user_id", profile.id);
  }

  return {
    email: normalizedEmail,
    user_id: profile.id,
    status: "linked_existing",
    bridge_customer_id: existing.id,
  };
}

async function migrateOne(email: string, dryRun: boolean) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { email, status: "skipped", reason: "empty_email" };

  const { data: profiles, error: profileErr } = await supabase
    .from("user_profiles")
    .select("id,email,full_name,account_type,country,phone,bridge_customer_id,is_admin")
    .ilike("email", normalizedEmail)
    .limit(2);
  if (profileErr) return { email: normalizedEmail, status: "error", reason: profileErr.message };
  if (!profiles?.length) return { email: normalizedEmail, status: "skipped", reason: "profile_not_found" };
  if (profiles.length > 1) return { email: normalizedEmail, status: "skipped", reason: "multiple_profiles" };

  const profile = profiles[0] as any;
  if (profile.is_admin === true || String(profile.email || "").toLowerCase().endsWith("@borderpayafrica.com")) {
    return { email: normalizedEmail, user_id: profile.id, status: "skipped", reason: "operator_account" };
  }
  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(profile.id);
  if (authErr || !authUser?.user) {
    return { email: normalizedEmail, user_id: profile.id, status: "error", reason: authErr?.message || "auth_user_not_found" };
  }
  if (!authUser.user.email_confirmed_at) {
    if (dryRun) {
      return {
        email: normalizedEmail,
        user_id: profile.id,
        status: "would_send_verification",
        reason: "email_not_verified",
      };
    }
    const purpose = profile.account_type === "business" ? "signup_business" : "signup_individual";
    const { data: tokenData, error: tokenErr } = await supabase.rpc("issue_email_token", {
      p_user_id: profile.id,
      p_purpose: purpose,
      p_ttl_minutes: 60 * 24,
      p_ip: null,
      p_ua: "bridge-missing-customer-migration",
    });
    if (tokenErr) {
      return {
        email: normalizedEmail,
        user_id: profile.id,
        status: "error",
        reason: `verification_token_failed: ${tokenErr.message}`,
      };
    }

    const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(tokenData as string)}&purpose=${purpose}`;
    const template = profile.account_type === "business"
      ? "business.email_verification"
      : "individual.email_verification";
    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: profile.email || normalizedEmail,
        user_id: profile.id,
        idempotency_key: `verify-repair:${profile.id}:${(tokenData as string).slice(0, 16)}`,
        props: {
          full_name: profile.full_name,
          verification_url: verifyUrl,
        },
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || !(sendJson as any)?.success) {
      return {
        email: normalizedEmail,
        user_id: profile.id,
        status: "error",
        reason: `verification_email_failed: ${(sendJson as any)?.error || `send-email HTTP ${sendRes.status}`}`,
      };
    }
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "verification_email_sent",
      reason: "email_not_verified",
    };
  }
  if (profile.bridge_customer_id) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "already_exists",
      bridge_customer_id: profile.bridge_customer_id,
    };
  }
  if (isBridgeBlocked(profile.country)) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "skipped",
      reason: "country_blocked",
      country: profile.country,
      bridge_response: bridgeCountryBlockResponse(profile.country),
    };
  }
  if (!String(profile.country || "").trim()) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "skipped",
      reason: "missing_country",
    };
  }

  let companyName: string | undefined;
  let registrationNumber: string | undefined;
  if (profile.account_type === "business") {
    const { data: biz } = await supabase
      .from("business_profiles")
      .select("company_name,registration_number")
      .eq("user_id", profile.id)
      .maybeSingle();
    companyName = (biz as any)?.company_name || undefined;
    registrationNumber = (biz as any)?.registration_number || undefined;
  }

  if (dryRun) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "would_create",
      account_type: profile.account_type,
      country: profile.country,
    };
  }

  logControlledBridgeTraffic("bridge-missing-customer-migration", profile.country, profile.id);
  try {
    const created = await bridgeProvider.createCustomer({
      account_type: profile.account_type === "business" ? "business" : "individual",
      email: profile.email || normalizedEmail,
      full_name: profile.full_name || undefined,
      company_name: companyName,
      registration_number: registrationNumber,
      country_code: String(profile.country).toUpperCase(),
      phone_e164: profile.phone || undefined,
      borderpay_user_id: profile.id,
    });

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("user_profiles")
      .update({
        bridge_customer_id: created.provider_id,
        bridge_kyc_status: "not_started",
        updated_at: now,
      })
      .eq("id", profile.id);
    if (updateErr) {
      return {
        email: normalizedEmail,
        user_id: profile.id,
        status: "error",
        reason: `created_on_bridge_but_profile_update_failed: ${updateErr.message}`,
        bridge_customer_id: created.provider_id,
      };
    }

    if (profile.account_type === "business") {
      await supabase
        .from("business_profiles")
        .update({ bridge_customer_id: created.provider_id, updated_at: now })
        .eq("user_id", profile.id);
    }

    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "created",
      bridge_customer_id: created.provider_id,
    };
  } catch (error) {
    if (shouldLinkExistingBridgeCustomer(error)) {
      try {
        return await linkExistingBridgeCustomer(profile, normalizedEmail);
      } catch (linkError) {
        return {
          email: normalizedEmail,
          user_id: profile.id,
          status: "error",
          reason: `existing_bridge_customer_link_failed: ${(linkError as Error).message}`,
          bridge_code: (linkError as any)?.bridge_code ?? null,
          bridge_error: (linkError as any)?.bridge_error ?? null,
          bridge_status: (linkError as any)?.status ?? null,
          bridge_request_id: (linkError as any)?.request_id ?? null,
          bridge_raw: (linkError as any)?.raw_text ?? null,
        };
      }
    }
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "error",
      reason: (error as Error).message,
      bridge_code: (error as any)?.bridge_code ?? null,
      bridge_error: (error as any)?.bridge_error ?? null,
      bridge_status: (error as any)?.status ?? null,
      bridge_request_id: (error as any)?.request_id ?? null,
      bridge_raw: (error as any)?.raw_text ?? null,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const serviceRoleEnvMatch = SERVICE_ROLE ? timingSafeEqualStr(token, SERVICE_ROLE) : false;
  if (!serviceRoleEnvMatch && !hasServiceRoleClaim(token)) {
    return json({ success: false, error: "service role required" }, 401);
  }

  let body: { emails?: string[]; dry_run?: boolean; limit?: number; include_all_missing?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  let emails = Array.isArray(body.emails) ? body.emails.map((v) => String(v)) : [];
  if (!emails.length && body.include_all_missing === true) {
    const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);
    const { data: missing, error: missingErr } = await supabase
      .from("user_profiles")
      .select("email")
      .is("bridge_customer_id", null)
      .not("email", "is", null)
      .eq("is_admin", false)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (missingErr) return json({ success: false, error: missingErr.message }, 500);
    emails = (missing || []).map((row: any) => String(row.email || ""));
  }
  if (!emails.length) return json({ success: false, error: "emails[] required" }, 400);
  if (emails.length > 200) return json({ success: false, error: "max 200 emails per request" }, 400);

  const uniqueEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const results = [];
  for (const email of uniqueEmails) {
    results.push(await migrateOne(email, body.dry_run === true));
  }

  return json({
    success: true,
    data: {
      dry_run: body.dry_run === true,
      results,
    },
  });
});
