import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";

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

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function isInternalEmail(email: string | null | undefined): boolean {
  const e = String(email || "").toLowerCase();
  if (!e) return false;
  return e.endsWith("@borderpayafrica.com") && e !== "founder@borderpayafrica.com";
}

type Candidate = {
  user_id: string;
  email: string | null;
  account_type: "individual" | "business";
  bridge_customer_id: string;
  created_at: string;
  bridge_kyc_status?: string | null;
  bridge_kyb_status?: string | null;
  bridge_kyc_link_id?: string | null;
  bridge_kyb_link_id?: string | null;
  verification_status?: string | null;
  va_count: number;
  wallet_count: number;
  transfer_count: number;
  external_count: number;
};

async function loadCandidates(limit: number): Promise<Candidate[]> {
  const { data: users, error } = await supa.rpc("get_bridge_cleanup_candidates", {
    p_limit: limit,
    p_age_days: 5,
  });
  if (error) throw new Error(`load candidates failed: ${error.message}`);
  return (users || []) as Candidate[];
}

async function audit(
  c: Candidate,
  action: "delete_bridge_customer" | "clear_local_bridge_id" | "skip",
  status: "success" | "failed",
  reason: string,
  details: Record<string, unknown> = {},
) {
  await supa.from("bridge_identity_cleanup_audit").insert({
    user_id: c.user_id,
    account_type: c.account_type,
    profile_table: c.account_type === "business" ? "business_profiles" : "user_profiles",
    bridge_customer_id: c.bridge_customer_id,
    action,
    status,
    reason,
    details,
  });
}

async function clearLocalBridgeIdentity(c: Candidate) {
  if (c.account_type === "business") {
    await supa
      .from("business_profiles")
      .update({
        bridge_customer_id: null,
        bridge_kyb_status: "not_started",
        bridge_kyb_link_id: null,
        bridge_kyb_link_url: null,
      })
      .eq("user_id", c.user_id);
  }

  await supa
    .from("user_profiles")
    .update({
      bridge_customer_id: null,
      bridge_kyc_status: "not_started",
      bridge_kyc_link_id: null,
      bridge_kyc_link_url: null,
      bridge_account_status: "not_started",
      bridge_verification_status: "not_started",
      verification_status: "not_started",
      kyc_status: "pending",
    })
    .eq("id", c.user_id);
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

  try {
    // Fail-closed by default. This endpoint is destructive and must be
    // explicitly enabled for a controlled maintenance window.
    const enabled = (Deno.env.get("BRIDGE_IDENTITY_CLEANUP_ENABLED") || "").toLowerCase() === "true";
    if (!enabled) {
      return json({
        success: false,
        code: "cleanup_disabled",
        error: "Bridge identity cleanup is disabled.",
      }, 503);
    }

    const secret =
      Deno.env.get("BRIDGE_IDENTITY_CLEANUP_SECRET") ||
      Deno.env.get("ADMIN_BROADCAST_INTERNAL_TOKEN");
    const passed = req.headers.get("x-cleanup-secret");
    if (!secret || !passed || passed !== secret) {
      return json({
        success: false,
        code: "invalid_cleanup_secret",
        error: "Unauthorized",
      }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(20, Number(body?.limit ?? 10)));
    const dryRun = body?.dry_run !== false;

    const candidates = await loadCandidates(limit);
    const out: Array<Record<string, unknown>> = [];

    for (const c of candidates) {
      if (isInternalEmail(c.email)) {
        await audit(c, "skip", "success", "internal_account_excluded");
        out.push({ user_id: c.user_id, bridge_customer_id: c.bridge_customer_id, action: "skip", reason: "internal_account_excluded" });
        continue;
      }

      try {
        if (!dryRun) {
          await bridgeProvider.deleteCustomer(c.bridge_customer_id);
          await clearLocalBridgeIdentity(c);
        }
        await audit(c, "delete_bridge_customer", "success", dryRun ? "dry_run" : "deleted_and_cleared", {
          dry_run: dryRun,
        });
        out.push({
          user_id: c.user_id,
          bridge_customer_id: c.bridge_customer_id,
          account_type: c.account_type,
          action: dryRun ? "would_delete_and_clear" : "deleted_and_cleared",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await audit(c, "delete_bridge_customer", "failed", "delete_failed", { error: msg });
        out.push({
          user_id: c.user_id,
          bridge_customer_id: c.bridge_customer_id,
          action: "failed",
          code: "delete_failed",
          error: "Unable to process this cleanup candidate right now.",
        });
      }
    }

    return json({
      success: true,
      dry_run: dryRun,
      scanned: candidates.length,
      results: out,
    });
  } catch {
    return json({
      success: false,
      code: "cleanup_internal_error",
      error: "Bridge identity cleanup failed. Retry later.",
    }, 500);
  }
});
