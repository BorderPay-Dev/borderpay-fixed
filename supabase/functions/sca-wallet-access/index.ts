import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { consumeScaAuthorization } from "../_shared/sca.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Unauthorized" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return json({ success: false, error: "Unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const request = { scope: "balances" };
  const sca = await consumeScaAuthorization({
    supabase,
    authorizationId: body.sca_authorization_id,
    userId: user.id,
    operation: "wallet_access",
    resource: "wallet_balances",
    request,
    // Only sca-authorize can issue this bound authorization, after checking
    // Bridge's authoritative Customer API scope.
    required: true,
  });
  if (!sca.ok) return json(sca.body, sca.status);
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { error: grantError } = await supabase.from("sca_wallet_access_grants").upsert({
    user_id: user.id,
    authorization_id: String(body.sca_authorization_id),
    granted_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { onConflict: "user_id" });
  if (grantError) return json({ success: false, code: "sca_unavailable", error: "Wallet access could not be granted." }, 503);
  return json({ success: true, data: { expires_at: expiresAt } });
});
