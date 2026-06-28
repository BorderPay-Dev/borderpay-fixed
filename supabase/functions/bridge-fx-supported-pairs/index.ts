import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const FALLBACK_SUPPORTED_FX_PAIRS = new Set([
  "USD_BRL", "BRL_USD",
  "USD_COP", "COP_USD",
  "USD_EUR", "EUR_USD",
  "USD_GBP", "GBP_USD",
  "USD_MXN", "MXN_USD",
  "USD_USDT", "USDT_USD",
]);

function parseSupportedFxPairsConfig(value: unknown): Set<string> | null {
  if (value == null) return null;
  const source = Array.isArray(value)
    ? value
    : (value && typeof value === "object" && Array.isArray((value as any).supported_pairs))
    ? (value as any).supported_pairs
    : null;
  if (!source) return new Set<string>();
  const out = new Set<string>();
  for (const raw of source) {
    const normalized = String(raw || "").trim().toUpperCase();
    if (/^[A-Z0-9]{2,10}_[A-Z0-9]{2,10}$/.test(normalized)) out.add(normalized);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ success: false, error: "GET only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !userInfo?.user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data } = await supa
    .from("provider_settings")
    .select("value")
    .eq("key", "bridge.fx.supported_pairs")
    .maybeSingle();

  const configuredPairs = parseSupportedFxPairsConfig(data?.value ?? null);
  const effectivePairs = configuredPairs ?? FALLBACK_SUPPORTED_FX_PAIRS;

  return json({
    success: true,
    data: {
      provider: "bridge",
      source: configuredPairs ? "provider_settings" : "fallback_default",
      supported_pairs: Array.from(effectivePairs).sort(),
    },
  });
});

