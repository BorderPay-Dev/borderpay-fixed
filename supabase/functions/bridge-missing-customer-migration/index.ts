import { remindBusiness } from "./reminders.ts";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";
import { bridgeOnboardingEnabled, bridgeOnboardingPausedBody } from "../_shared/launch-gates.ts";
// bridge-missing-customer-migration
//
// Operator-only repair for email-confirmed users that have no Bridge customer
// id. Unconfirmed users get a fresh verification email instead. This calls
// Bridge only for email-confirmed users; it never writes fake provider ids.

import { exactServiceCredential, restrictionReason, providerLinkReason } from "./policy.ts";
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

function shouldLinkExistingBridgeCustomer(error: unknown): boolean {
  const raw = String((error as any)?.raw_text || "").toLowerCase();
  const msg = `${String((error as any)?.bridge_code || "")} ${String((error as any)?.bridge_error || "")} ${String((error as Error)?.message || "")}`.toLowerCase();
  return (
    raw.includes("a customer with this email already exists") ||
    raw.includes("idempotency key retry deadline exceeded") ||
    msg.includes("idempotency key retry deadline exceeded")
  );
}

async function linkExistingBridgeCustomer(profile: any, normalizedEmail: string, business: any) {
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
  const mismatch = providerLinkReason(raw, profile, business);
  if (mismatch) return { email: normalizedEmail, user_id: profile.id, status: "skipped", reason: mismatch };
  for (const [table, column] of [["user_profiles", "id"], ["business_profiles", "user_id"]]) {
    const { data, error } = await supabase.from(table).select(column).eq("bridge_customer_id", existing.id).neq(column, profile.id).limit(1);
    if (error || data?.length) return { email: normalizedEmail, status: "skipped", reason: "provider_mapping_requires_review" };
  }
  const now = new Date().toISOString();
  const { data: updatedProfiles, error: updateErr } = await supabase
    .from("user_profiles")
    .update({
      bridge_customer_id: existing.id,
      updated_at: now,
    })
    .eq("id", profile.id).is("bridge_customer_id", null).eq("account_status", "pending_kyc").is("account_frozen_at", null).select("id");
  if (updateErr || updatedProfiles?.length !== 1) {
    return {
      email: normalizedEmail,
      user_id: profile.id,
      status: "error",
      reason: `existing_bridge_customer_profile_update_failed: ${updateErr?.message || "profile_changed_during_repair"}`,
      bridge_customer_id: existing.id,
    };
  }

  if (profile.account_type === "business") {
    const { error: businessUpdateError } = await supabase
      .from("business_profiles")
      .update({ bridge_customer_id: existing.id, updated_at: now })
      .eq("user_id", profile.id);
    if (businessUpdateError) return { email: normalizedEmail, status: "error", reason: "business_mapping_update_failed" };
  }

  return {
    email: normalizedEmail,
    user_id: profile.id,
    status: "linked_existing",
    bridge_customer_id: existing.id,
  };
}

async function migrateOne(email: string, dryRun: boolean, notify: boolean) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { email, status: "skipped", reason: "empty_email" };

  const { data: profiles, error: profileErr } = await supabase
    .from("user_profiles")
    .select("id,email,full_name,account_type,country,phone,bridge_customer_id,is_admin,is_demo,account_status,bridge_account_status,bridge_kyc_status,payment_provider,account_frozen_at,account_frozen_reason")
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
  const { data: businesses, error: bizError } = await supabase.from("business_profiles")
    .select("company_name,registration_number,country,status,bridge_customer_id,bridge_kyb_status,user_id").eq("user_id", profile.id).limit(2);
  if (bizError || (businesses?.length || 0) > 1) return { email: normalizedEmail, status: "skipped", reason: "business_mapping_requires_review" };
  const business = businesses?.[0];
  const restriction = restrictionReason(profile, business, authUser.user);
  if (restriction) return { email: normalizedEmail, status: "skipped", reason: restriction };
  // Respect IDs in BOTH profile tables before verification emails or provider calls.
  if (profile.bridge_customer_id || business?.bridge_customer_id) return { email: normalizedEmail, status: "already_exists" };
  if (profile.account_type === "business") {
    if (!business?.company_name?.trim()) return { email: normalizedEmail, status: "skipped", reason: "missing_business_details" };
    profile.country = business.country || profile.country;
    // A confirmed replacement email may supersede an unconfirmed signup only when
    // neither record has a provider customer. Never relink across customer emails.
    const { data: allBusinesses, error } = await supabase.from("business_profiles")
      .select("user_id,company_name,registration_number,country,bridge_customer_id");
    if (error) return { email: normalizedEmail, status: "error", reason: "duplicate_check_failed" };
    const normalize = (v: unknown) => String(v || "").trim().toLowerCase();
    const siblings = (allBusinesses || []).filter((row: any) => row.user_id !== profile.id && normalize(row.country) === normalize(business.country) &&
      (normalize(row.company_name) === normalize(business.company_name) || (business.registration_number && normalize(row.registration_number) === normalize(business.registration_number))));
    for (const sibling of siblings) {
      const { data: other, error: otherError } = await supabase.auth.admin.getUserById(sibling.user_id);
      const { data: otherProfile, error: otherProfileError } = await supabase.from("user_profiles").select("bridge_customer_id").eq("id", sibling.user_id).maybeSingle();
      if (otherError || otherProfileError || sibling.bridge_customer_id || otherProfile?.bridge_customer_id || other?.user?.email_confirmed_at || !authUser.user.email_confirmed_at)
        return { email: normalizedEmail, status: "skipped", reason: "duplicate_business_requires_review" };
    }
  }
  if (isBridgeBlocked(profile.country)) return { email: normalizedEmail, status: "skipped", reason: "country_blocked" };
  if (!String(profile.country || "").trim()) return { email: normalizedEmail, status: "skipped", reason: "missing_country" };
  if (!authUser.user.email_confirmed_at) {
    if (dryRun) {
      return {
        email: normalizedEmail,
        user_id: profile.id,
        status: "would_send_verification",
        reason: "email_not_verified",
      };
    }
    if (!notify) return { email: normalizedEmail, status: "skipped", reason: "email_not_verified" };
    const purpose = profile.account_type === "business" ? "signup_business" : "signup_individual";
    const verificationKey = `verify-onboarding-resume-20260925:${profile.id}`;
    const { data: prior, error: priorError } = await supabase.from("email_log").select("status").eq("idempotency_key", verificationKey).maybeSingle();
    if (priorError) return { email: normalizedEmail, status: "error", reason: "email_history_unavailable" };
    if (prior) return { email: normalizedEmail, status: "verification_email_already_requested", email_status: prior.status };
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
        idempotency_key: verificationKey,
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
      status: "verification_email_requested",
      email_status: (sendJson as any)?.data?.status || "sent",
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

  const companyName = business?.company_name || undefined;
  const registrationNumber = business?.registration_number || undefined;
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
    const { data: updatedProfiles, error: updateErr } = await supabase
      .from("user_profiles")
      .update({
        bridge_customer_id: created.provider_id,
        updated_at: now,
      })
      .eq("id", profile.id).is("bridge_customer_id", null).eq("account_status", "pending_kyc").is("account_frozen_at", null).select("id");
    if (updateErr || updatedProfiles?.length !== 1) {
      return {
        email: normalizedEmail,
        user_id: profile.id,
        status: "error",
        reason: `created_on_bridge_but_profile_update_failed: ${updateErr?.message || "profile_changed_during_repair"}`,
        bridge_customer_id: created.provider_id,
      };
    }

    if (profile.account_type === "business") {
      const { error: businessUpdateError } = await supabase
        .from("business_profiles")
        .update({ bridge_customer_id: created.provider_id, updated_at: now })
        .eq("user_id", profile.id);
      if (businessUpdateError) return { email: normalizedEmail, status: "error", reason: "business_mapping_update_failed" };
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
        return await linkExistingBridgeCustomer(profile, normalizedEmail, business);
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

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!exactServiceCredential(token, SERVICE_ROLE)) {
    return json({ success: false, error: "service role required" }, 401);
  }

  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);

  let body: { action?: string; user_ids?: string[]; emails?: string[]; dry_run?: boolean; limit?: number; include_all_missing?: boolean; notify?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  if (body.action === "remind_business_verification") {
    const ids = [...new Set(body.user_ids || [])];
    if (!ids.length || ids.length > 25 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return json({ success: false, error: "1–25 valid user_ids required" }, 400);
    const send = async (payload: unknown) => {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SEND_EMAIL_TOKEN}` }, body: JSON.stringify(payload) });
      return { ok: response.ok, body: await response.json().catch(() => ({})) };
    };
    const results = [];
    for (const id of ids) {
      try { results.push(await remindBusiness(supabase, bridgeFetch, send, id, body.dry_run !== false)); }
      catch { results.push({ user_id: id, status: "error", reason: "reminder_request_failed" }); }
    }
    return json({ success: true, data: { dry_run: body.dry_run !== false, results } });
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
    const result = await migrateOne(email, body.dry_run === true, body.notify === true);
    if (body.notify === true && body.dry_run !== true && ["created", "linked_existing"].includes(result.status)) {
      try {
      const { data: profile } = await supabase.from("user_profiles").select("id,full_name,account_type").ilike("email", email).single();
      if (!profile) throw new Error("profile_unavailable");
      const { data: business } = await supabase.from("business_profiles").select("company_name").eq("user_id", profile.id).maybeSingle();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SEND_EMAIL_TOKEN}` },
        body: JSON.stringify({ template: profile.account_type === "business" ? "business.onboarding_lifecycle" : "individual.verification_reminder",
          to: email, user_id: profile.id, idempotency_key: `welcome-onboarding-resume-20260925:${profile.id}`,
          props: { company_name: business?.company_name, full_name: profile.full_name, stage: "day_1" } }),
      });
      const sent = await response.json().catch(() => ({}));
      Object.assign(result, { email_status: response.ok && sent.success ? (sent.data?.status || "sent") : "failed" });
      } catch { Object.assign(result, { email_status: "failed" }); }
    }
    results.push(result);
  }

  return json({
    success: true,
    data: {
      dry_run: body.dry_run === true,
      results,
    },
  });
});
