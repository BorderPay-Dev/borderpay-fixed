import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { redactFeeAccountResponse, validateFeeAccountInput } from "../_shared/bridge-fee-account.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bridgeKey = Deno.env.get("BRIDGE_FEE_API_KEY") || "";
  const bridgeBaseUrl = (Deno.env.get("BRIDGE_BASE_URL") || "https://api.bridge.xyz").replace(/\/+$/, "");
  if (!supabaseUrl || !serviceRole || !bridgeKey) {
    return json({ success: false, error: "Server configuration missing" }, 500);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const supa = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userInfo, error: authError } = await supa.auth.getUser(token);
  if (authError || !userInfo?.user) return json({ success: false, error: "Unauthorized" }, 401);
  const { data: admin, error: adminError } = await supa
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userInfo.user.id)
    .maybeSingle();
  if (adminError || !admin) return json({ success: false, error: "admin only" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action || "status");
  if (action !== "status" && action !== "configure") {
    return json({ success: false, error: "Unsupported action" }, 400);
  }

  const method = action === "status" ? "GET" : "POST";
  const headers: Record<string, string> = {
    "Api-Key": bridgeKey,
    "Accept": "application/json",
    "User-Agent": "borderpay-edge/admin-bridge-fee-account",
  };
  let requestBody: Record<string, unknown> | undefined;
  if (action === "configure") {
    if (body.confirm !== "CONFIGURE_FEE_EXTERNAL_ACCOUNT") {
      return json({ success: false, error: "Explicit confirmation required" }, 409);
    }
    const idempotencyKey = String(req.headers.get("Idempotency-Key") || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 256) {
      return json({ success: false, error: "Valid Idempotency-Key required" }, 400);
    }
    const validated = validateFeeAccountInput(body);
    if (!validated.ok) return json({ success: false, error: validated.error }, 400);
    requestBody = validated.payload;
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${bridgeBaseUrl}/v0/developer/fee_external_account`, {
      method,
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    });
  } catch {
    return json({ success: false, error: "Fee account service unavailable" }, 502);
  }
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || null;
  let responseBody: unknown = null;
  try { responseBody = JSON.parse(await response.text()); } catch { /* never return raw provider content */ }

  console.info(JSON.stringify({
    event: `bridge_fee_account_${action}`,
    actor_user_id: userInfo.user.id,
    status: response.status,
    request_id: requestId,
  }));

  if (!response.ok) {
    return json({
      success: false,
      error: "Fee account request was rejected",
      status: response.status,
      request_id: requestId,
    }, response.status === 401 || response.status === 403 ? 502 : response.status);
  }

  return json({
    success: true,
    data: redactFeeAccountResponse(responseBody),
    request_id: requestId,
  });
});
