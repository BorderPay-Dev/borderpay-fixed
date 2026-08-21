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
  if (error || !user?.email) return json({ success: false, error: "Unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const currentPassword = String(body.current_password || "");
  const newPassword = String(body.new_password || "");
  if (newPassword.length < 8 || newPassword.length > 128) return json({ success: false, error: "New password does not meet requirements." }, 400);
  const verifier = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: passwordError } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (passwordError) return json({ success: false, error: "Current password is incorrect." }, 401);
  const sca = await consumeScaAuthorization({
    supabase,
    authorizationId: body.sca_authorization_id,
    userId: user.id,
    operation: "security_change",
    resource: "change_password",
    request: { action: "change_password" },
  });
  if (!sca.ok) return json(sca.body, sca.status);
  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updateError) return json({ success: false, error: "Password could not be changed." }, 500);
  return json({ success: true });
});
