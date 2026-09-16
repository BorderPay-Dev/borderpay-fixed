import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveBridgeWalletAssetScope } from "../_shared/bridge-sca-scope.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // PostgREST validates the caller's JWT against this project and enforces
  // EXECUTE permission (service_role only). Never substitute the runtime's
  // privileged Authorization header when claiming on the caller's behalf.
  let claimResponse: Response;
  try {
    claimResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/claim_wallet_scope_refresh_batch`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: 20 }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json({ error: "Scope refresh authorization unavailable" }, { status: 503 });
  }
  if (claimResponse.status === 401 || claimResponse.status === 403) {
    return Response.json({ error: "Scheduler credential rejected by Supabase", code: "scope_refresh_credential_rejected" }, { status: 401 });
  }
  if (!claimResponse.ok) return Response.json({ error: "Scope refresh queue unavailable" }, { status: 503 });
  const jobs = await claimResponse.json().catch(() => null);
  if (!Array.isArray(jobs)) return Response.json({ error: "Invalid scope refresh queue response" }, { status: 503 });
  let refreshed = 0, failed = 0;
  // Two concurrent Bridge reads; leases prevent overlapping cron invocations
  // from refreshing the same customer. Failures remain due after five minutes.
  const pending = [...(jobs || [])] as Array<{ user_id: string; lease_token: string }>;
  const run = async () => {
    while (pending.length) {
      const job = pending.shift()!;
      let reason: string | null = null;
      try {
        const scope = await resolveBridgeWalletAssetScope(supabase, job.user_id);
        if (scope.region === "unknown") reason = "diagnostic_code" in scope && scope.diagnostic_code ? scope.diagnostic_code : scope.reason;
      } catch {
        reason = "provider_scope_refresh_failed";
      }
      const now = new Date();
      const { error: writeError } = await supabase.from("wallet_scope_refresh_jobs").update({
        next_attempt_at: new Date(now.getTime() + (reason ? 5 : 40) * 60_000).toISOString(),
        last_error: reason,
        ...(reason ? {} : { last_success_at: now.toISOString() }),
        updated_at: now.toISOString(),
      }).eq("user_id", job.user_id).eq("lease_token", job.lease_token);
      if (reason || writeError) failed++;
      else refreshed++;
    }
  };
  await Promise.all([run(), run()]);
  return Response.json({ claimed: jobs?.length || 0, refreshed, failed });
});
