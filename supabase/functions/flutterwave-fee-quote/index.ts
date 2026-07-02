import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  quoteFlutterwaveFee,
  type FlutterwaveDirection,
  type FlutterwaveChannel,
} from "../_shared/fees/flutterwave-policy.ts";
import { gateFlutterwaveRuntime, validateCurrencyOnPolicy } from "../_shared/services/flutterwave-runtime.ts";

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
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function isDirection(v: unknown): v is FlutterwaveDirection {
  return v === "receive" || v === "payout";
}
function isChannel(v: unknown): v is FlutterwaveChannel {
  return v === "bank" || v === "mobile_money";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const runtimeGate = gateFlutterwaveRuntime("either");
  if (!runtimeGate.allowed) return json(runtimeGate.body, runtimeGate.status);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !userInfo?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const direction = String(body?.direction || "").toLowerCase();
  const channel = String(body?.channel || "").toLowerCase();
  const currency = String(body?.currency || "").toUpperCase();
  const amount = Number(body?.amount);

  if (!isDirection(direction)) return json({ success: false, error: "direction must be receive|payout" }, 400);
  if (!isChannel(channel)) return json({ success: false, error: "channel must be bank|mobile_money" }, 400);
  const supportedCurrencies = runtimeGate.staticIpGuard.policy.currencies as readonly string[];
  const currencyPolicy = validateCurrencyOnPolicy(currency, supportedCurrencies);
  if (!currencyPolicy.allowed) return json(currencyPolicy.body, currencyPolicy.status);
  if (!Number.isFinite(amount) || amount <= 0) return json({ success: false, error: "amount must be > 0" }, 400);

  try {
    const quote = await quoteFlutterwaveFee(supa, {
      direction,
      channel,
      currency,
      amount,
    });
    return json({ success: true, data: quote });
  } catch (e) {
    const raw = String((e as Error)?.message || "quote_failed");
    if (raw.startsWith("fee_schedule_missing:") || raw.startsWith("fee_band_not_found:")) {
      return json({ success: false, code: "pricing_unavailable", error: "Pricing is not configured for this corridor yet." }, 409);
    }
    return json({ success: false, code: "quote_failed", error: "Could not calculate route fee right now." }, 500);
  }
});
