import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  BRIDGE_FX_FALLBACK_SUPPORTED_PAIRS,
  loadSupportedFxPairsFromSettings,
} from "../_shared/providers/bridge-fx-policy.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "GET",
    }, 405);
  }

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({
      success: false,
      code: "missing_bearer_token",
      error: "Authentication required",
    }, 401);
  }

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !userInfo?.user) {
    return json({
      success: false,
      code: "invalid_auth_token",
      error: "Unauthorized",
    }, 401);
  }

  const configuredPairs = await loadSupportedFxPairsFromSettings(supa);
  const effectivePairs = configuredPairs ?? BRIDGE_FX_FALLBACK_SUPPORTED_PAIRS;

  return json({
    success: true,
    code: "fx_supported_pairs_ready",
    summary: {
      code: "fx_supported_pairs_ready",
      provider: "bridge",
      source: configuredPairs ? "provider_settings" : "fallback_default",
      pair_count: effectivePairs.size,
    },
    data: {
      provider: "bridge",
      source: configuredPairs ? "provider_settings" : "fallback_default",
      supported_pairs: Array.from(effectivePairs).sort(),
      pair_count: effectivePairs.size,
    },
  });
});
