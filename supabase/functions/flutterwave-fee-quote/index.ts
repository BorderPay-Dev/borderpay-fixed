import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  quoteFlutterwaveFee,
  type FlutterwaveDirection,
  type FlutterwaveChannel,
} from "../_shared/fees/flutterwave-policy.ts";
import { getFlutterwaveLocalRailPolicy } from "../_shared/providers/flutterwave.ts";

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

const FLW_ENABLED = (Deno.env.get("FLW_PAYOUT_ENABLED") || "").toLowerCase() === "true"
  || (Deno.env.get("FLW_RECEIVE_ENABLED") || "").toLowerCase() === "true";

function isDirection(v: unknown): v is FlutterwaveDirection {
  return v === "receive" || v === "payout";
}
function isChannel(v: unknown): v is FlutterwaveChannel {
  return v === "bank" || v === "mobile_money";
}
function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3,5}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  if (!FLW_ENABLED) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave rails are not enabled in this environment.",
    }, 503);
  }

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

  const direction = body?.direction;
  const channel = body?.channel;
  const currency = String(body?.currency || "").toUpperCase();
  const amount = Number(body?.amount);

  if (!isDirection(direction)) return json({ success: false, error: "direction must be receive|payout" }, 400);
  if (!isChannel(channel)) return json({ success: false, error: "channel must be bank|mobile_money" }, 400);
  if (!currency) return json({ success: false, error: "currency is required" }, 400);
  if (!isCurrencyCode(currency)) return json({ success: false, error: "currency format is invalid" }, 400);
  const localRailPolicy = getFlutterwaveLocalRailPolicy();
  const supportedCurrencies = localRailPolicy.currencies as readonly string[];
  if (!supportedCurrencies.includes(currency)) {
    return json({
      success: false,
      code: "corridor_not_supported",
      error: "This currency is not enabled on local rails.",
      data: { supported_currencies: supportedCurrencies },
    }, 409);
  }
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
