import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { consumeScaAuthorization } from "../_shared/sca.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
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
  const body = await req.json().catch(() => ({}));
  const request = { purpose: "financial_account_access" };
  const consumed = await consumeScaAuthorization({
    supabase,
    authorizationId: body?.sca_authorization_id,
    userId: user.id,
    operation: "wallet_access",
    resource: "financial_account_access",
    request,
  });
  if (!consumed.ok) return json(consumed.body, consumed.status);
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  if (consumed.required) {
    const { error: grantError } = await supabase.from("sca_wallet_access_grants").upsert({
      user_id: user.id,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt,
      authorization_id: body?.sca_authorization_id,
    }, { onConflict: "user_id" });
    if (grantError) return json({ success: false, code: "sca_grant_unavailable", error: "Financial access could not be recorded." }, 503);
  }
  return json({ success: true, data: { granted: true, required: consumed.required, expires_at: expiresAt } });
});
