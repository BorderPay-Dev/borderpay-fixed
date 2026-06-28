import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

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
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!isAuthorized(req.headers.get("Authorization"))) {
    return json({ success: false, error: "Unauthorized" }, 401);
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
  if (qErr) return json({ success: false, error: `Query failed: ${qErr.message}` }, 500);

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
      await supa
        .from("user_profiles")
        .update({
          bridge_customer_id: bridgeCustomerId,
          bridge_kyc_status: "not_started",
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);

      if (c.account_type === "business" && includeBusiness) {
        await supa
          .from("business_profiles")
          .update({
            bridge_customer_id: bridgeCustomerId,
            bridge_kyb_status: "not_started",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", c.id);
      }

      row.status = "created";
      row.bridge_customer_id = bridgeCustomerId;
      created += 1;
      results.push(row);
    } catch (e) {
      row.status = "failed";
      row.error = (e as Error).message;
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
