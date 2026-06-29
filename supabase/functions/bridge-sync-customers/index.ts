import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { BridgeProviderError } from "../_shared/providers/bridge-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") || "";

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

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SyncBody = {
  limit?: number;
  emails?: string[];
  include_business?: boolean;
};

const INTERNAL_DOMAIN = "@borderpayafrica.com";
const INTERNAL_ALLOWLIST = new Set(["founder@borderpayafrica.com"]);

function mapSyncCustomerError(
  error: unknown,
  options?: { accountType?: "individual" | "business" | null },
): {
  code: string;
  message: string;
  provider_code?: string;
  bridge_request_id?: string;
  expected_verification_status?: "approved";
} {
  const message = String((error as Error)?.message || "").toLowerCase();
  const providerCode = error instanceof BridgeProviderError
    ? String(error.bridge_code || "").toLowerCase()
    : undefined;
  const bridgeRequestId = error instanceof BridgeProviderError ? error.request_id || undefined : undefined;
  const isBusiness = options?.accountType === "business";
  if (providerCode === "has_not_accepted_tos" || message.includes("has_not_accepted_tos")) {
    return {
      code: "tos_required",
      message: "Customer must accept terms of service before provisioning can continue.",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
    };
  }
  if (providerCode === "requires_active_kyc_status" || message.includes("requires_active_kyc_status")) {
    return {
      code: "kyc_not_approved",
      message: isBusiness
        ? "Business verification is required before this operation can continue."
        : "Identity verification is required before this operation can continue.",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
      expected_verification_status: "approved",
    };
  }
  if (message.includes("rate") || message.includes("429")) {
    return { code: "rate_limited", message: "Provider rate limit reached. Retry later." };
  }
  if (message.includes("timeout") || message.includes("network")) {
    return {
      code: "provider_unavailable",
      message: "Provider is temporarily unavailable. Retry later.",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
    };
  }
  return {
    code: "sync_failed",
    message: "Unable to sync customer at this time.",
    ...(providerCode ? { provider_code: providerCode } : {}),
    ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(b64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const [sub] = host.split(".");
    return sub || null;
  } catch {
    return null;
  }
}

function isAuthorized(authHeader: string | null): boolean {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;
  if (ADMIN_SECRET && token === ADMIN_SECRET) return true;

  // Gateway should already verify JWT signature. We only inspect claims here
  // to allow legacy service_role JWT keys for internal batch operations.
  const payload = decodeJwtPayload(token);
  const role = String(payload?.role || "");
  const ref = String(payload?.ref || "");
  const expectedRef = projectRefFromUrl(SUPABASE_URL) || "";
  return role === "service_role" && ref.length > 0 && ref === expectedRef;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }
  if (!isAuthorized(req.headers.get("Authorization"))) {
    return json({
      success: false,
      code: "unauthorized_admin_access",
      error: "Unauthorized",
    }, 401);
  }

  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    // tolerate empty body
  }

  const limit = Math.max(1, Math.min(100, Number(body.limit || 10)));
  const includeBusiness = body.include_business !== false;
  const requestedEmails = (Array.isArray(body.emails) ? body.emails : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean);

  let query = supa
    .from("user_profiles")
    .select("id,email,full_name,account_type,country,phone,bridge_customer_id,is_admin")
    .is("bridge_customer_id", null)
    .eq("payment_provider", "bridge")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (requestedEmails.length > 0) {
    query = query.in("email", requestedEmails);
  }

  const { data: candidates, error: qErr } = await query;
  if (qErr) {
    return json({
      success: false,
      code: "sync_query_failed",
      error: "Unable to load sync candidates right now. Please retry.",
    }, 500);
  }

  const results: Array<Record<string, unknown>> = [];
  let created = 0;
  let already = 0;
  let failed = 0;
  let skipped = 0;

  for (const c of candidates || []) {
    const email = String(c.email || "").trim().toLowerCase();
    const isInternalEmail = email.endsWith(INTERNAL_DOMAIN);
    const isAllowlistedInternal = INTERNAL_ALLOWLIST.has(email);

    const row: Record<string, unknown> = {
      user_id: c.id,
      email: c.email,
      account_type: c.account_type,
      status: "pending",
    };
    try {
      if (isInternalEmail && !isAllowlistedInternal) {
        row.status = "skipped_internal_domain";
        skipped += 1;
        results.push(row);
        continue;
      }

      if (c.is_admin === true) {
        row.status = "skipped_admin";
        skipped += 1;
        results.push(row);
        continue;
      }

      if (c.account_type !== "individual" && c.account_type !== "business") {
        row.status = "skipped_invalid_account_type";
        skipped += 1;
        results.push(row);
        continue;
      }

      if (c.bridge_customer_id) {
        row.status = "already_exists";
        row.bridge_customer_id = c.bridge_customer_id;
        already += 1;
        results.push(row);
        continue;
      }

      let companyName: string | undefined;
      let registrationNumber: string | undefined;
      if (c.account_type === "business" && !includeBusiness) {
        row.status = "skipped_business_excluded";
        skipped += 1;
        results.push(row);
        continue;
      }

      if (c.account_type === "business") {
        const { data: biz } = await supa
          .from("business_profiles")
          .select("company_name,registration_number")
          .eq("user_id", c.id)
          .maybeSingle();
        companyName = biz?.company_name || undefined;
        registrationNumber = biz?.registration_number || undefined;
        if (!companyName) {
          row.status = "skipped_business_incomplete";
          skipped += 1;
          results.push(row);
          continue;
        }
      }

      const createdCustomer = await bridgeProvider.createCustomer({
        account_type: c.account_type as "individual" | "business",
        email: c.email,
        full_name: c.full_name || undefined,
        company_name: companyName,
        registration_number: registrationNumber,
        country_code: String(c.country || "NG").toUpperCase(),
        phone_e164: c.phone || undefined,
        borderpay_user_id: c.id,
      });

      const bridgeCustomerId = createdCustomer.provider_id;
      const profileStatusUpdate =
        c.account_type === "business"
          ? { bridge_kyb_status: "not_started" as const }
          : { bridge_kyc_status: "not_started" as const };
      const { error: profileUpdateErr } = await supa
        .from("user_profiles")
        .update({
          bridge_customer_id: bridgeCustomerId,
          ...profileStatusUpdate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      if (profileUpdateErr) {
        throw new Error(`profile_update_failed:${profileUpdateErr.message}`);
      }

      if (c.account_type === "business" && includeBusiness) {
        const { error: businessUpdateErr } = await supa
          .from("business_profiles")
          .update({
            bridge_customer_id: bridgeCustomerId,
            bridge_kyb_status: "not_started",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", c.id);
        if (businessUpdateErr) {
          throw new Error(`business_update_failed:${businessUpdateErr.message}`);
        }
      }

      row.status = "created";
      row.bridge_customer_id = bridgeCustomerId;
      created += 1;
      results.push(row);
    } catch (e) {
      row.status = "failed";
      const mapped = mapSyncCustomerError(e, {
        accountType: c.account_type as "individual" | "business",
      });
      row.error_code = mapped.code;
      row.error = mapped.message;
      if (mapped.provider_code) row.provider_code = mapped.provider_code;
      if (mapped.bridge_request_id) row.bridge_request_id = mapped.bridge_request_id;
      if (mapped.expected_verification_status) {
        row.expected_verification_status = mapped.expected_verification_status;
      }
      failed += 1;
      results.push(row);
    }
  }

  return json({
    success: true,
    scanned: candidates?.length || 0,
    created,
    already_exists: already,
    failed,
    skipped,
    results,
  });
});
