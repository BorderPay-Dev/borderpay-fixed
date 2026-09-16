import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveBridgeWalletAssetScope } from "../_shared/bridge-sca-scope.ts";

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function authorized(token: string): Promise<boolean> {
  if (!token || !serviceKey) return false;
  const hash = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([hash(token), hash(serviceKey)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await authorized(token))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: jobs, error } = await supabase.rpc("claim_wallet_scope_refresh_batch", { p_limit: 20 });
  if (error) return Response.json({ error: "Scope refresh queue unavailable" }, { status: 503 });
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
        if (scope.region === "unknown") reason = scope.reason;
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
