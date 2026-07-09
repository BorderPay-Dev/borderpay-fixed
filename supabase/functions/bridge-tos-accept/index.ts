// bridge-tos-accept — durable ToS acceptance before Bridge KYC/KYB.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
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
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CURRENT_TOS_VERSION = "2024-11-14";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { version?: string } = {};
  try { body = await req.json(); } catch { /* tolerant */ }

  const version = String(body.version || CURRENT_TOS_VERSION).trim() || CURRENT_TOS_VERSION;
  const acceptedAt = new Date().toISOString();

  const { data, error } = await supa
    .from("user_profiles")
    .update({
      tos_accepted_at: acceptedAt,
      tos_version: version,
      updated_at: acceptedAt,
    })
    .eq("id", user.id)
    .select("id,tos_accepted_at,tos_version")
    .maybeSingle();

  if (error) {
    return json({ success: false, error: `ToS acceptance failed: ${error.message}` }, 500);
  }
  if (!data?.id) {
    return json({ success: false, error: "user_profiles row missing" }, 404);
  }

  return json({
    success: true,
    data: {
      tos_accepted_at: data.tos_accepted_at,
      tos_version: data.tos_version,
    },
  });
});
