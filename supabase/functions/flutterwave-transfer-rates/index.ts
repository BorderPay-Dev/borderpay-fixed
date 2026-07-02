import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  getFlutterwaveCapabilities,
  flutterwaveGetTransferRates,
  getFlutterwaveLocalRailPolicy,
} from "../_shared/providers/flutterwave.ts";
import { mapFlutterwaveErrorResponse } from "../_shared/providers/flutterwave-error-response.ts";

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

function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3,5}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !(caps.receive_enabled || caps.payout_enabled)) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave transfer rates are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const source = String(body?.source_currency || "").trim().toUpperCase();
  const destination = String(body?.destination_currency || "").trim().toUpperCase();
  const amountRaw = body?.amount;
  const amount = amountRaw === undefined || amountRaw === null || amountRaw === ""
    ? undefined
    : Number(amountRaw);

  if (!source || !destination) {
    return json({ success: false, error: "source_currency and destination_currency are required" }, 400);
  }
  if (source === destination) {
    return json({ success: false, error: "source_currency and destination_currency must be different" }, 400);
  }
  if (!isCurrencyCode(source) || !isCurrencyCode(destination)) {
    return json({ success: false, error: "currency format is invalid" }, 400);
  }
  const localRailPolicy = getFlutterwaveLocalRailPolicy();
  const supportedCurrencies = localRailPolicy.currencies as readonly string[];
  if (!supportedCurrencies.includes(source) || !supportedCurrencies.includes(destination)) {
    return json({
      success: false,
      code: "corridor_not_supported",
      error: "Requested currency pair is not enabled on local rails.",
      data: { supported_currencies: supportedCurrencies },
    }, 409);
  }
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    return json({ success: false, error: "amount must be > 0" }, 400);
  }

  const res = await flutterwaveGetTransferRates({
    source_currency: source,
    destination_currency: destination,
    amount,
  });
  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to fetch transfer rates");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: {
        capabilities: caps,
        source_currency: source,
        destination_currency: destination,
      },
    }, mapped.status);
  }

  return json({
    success: true,
    data: {
      capabilities: caps,
      source_currency: source,
      destination_currency: destination,
      amount: amount ?? null,
      rates: res.data,
    },
  });
});
