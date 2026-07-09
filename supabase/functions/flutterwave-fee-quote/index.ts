import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";

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

const PRODUCT = "flutterwave_local_rails";
const PRICING_VERSION = "2026-07-recovery-v1";

function asPositiveNumber(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function envNum(name: string, fallback: number): number {
  const raw = String(Deno.env.get(name) || "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured) {
    return json(
      {
        success: false,
        code: "flutterwave_not_configured",
        error: "Flutterwave is not configured in this environment.",
        data: { capabilities: caps },
      },
      503,
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const direction = String(body?.direction || "").trim().toLowerCase();
  const channel = String(body?.channel || "").trim().toLowerCase();
  const currency = String(body?.currency || "").trim().toUpperCase();
  const amount = asPositiveNumber(body?.amount);

  if (!["payout", "receive"].includes(direction)) {
    return json({ success: false, error: "direction must be payout or receive" }, 400);
  }
  if (!["bank", "mobile_money"].includes(channel)) {
    return json({ success: false, error: "channel must be bank or mobile_money" }, 400);
  }
  if (!currency) {
    return json({ success: false, error: "currency is required" }, 400);
  }
  if (!amount) {
    return json({ success: false, error: "amount must be > 0" }, 400);
  }

  // Provider fee can be tuned per channel via env without redeploying frontend.
  const providerPctBank = envNum("FLW_PROVIDER_FEE_PCT_BANK", 0);
  const providerPctMomo = envNum("FLW_PROVIDER_FEE_PCT_MOBILE_MONEY", 0);
  const providerFlatBank = envNum("FLW_PROVIDER_FEE_FLAT_BANK", 0);
  const providerFlatMomo = envNum("FLW_PROVIDER_FEE_FLAT_MOBILE_MONEY", 0);

  // BorderPay markup policy for local rails. Default is conservative and env-overridable.
  const markupPct = envNum("FLW_MARKUP_PCT", 0.25);
  const markupFlat = envNum("FLW_MARKUP_FLAT", 1.0);
  const hardCapMultiplier = envNum("FLW_FEE_HARD_CAP_MULTIPLIER", 0);

  const providerPct = channel === "mobile_money" ? providerPctMomo : providerPctBank;
  const providerFlat = channel === "mobile_money" ? providerFlatMomo : providerFlatBank;

  const providerFee = providerFlat + amount * (providerPct / 100);
  const markupFee = markupFlat + amount * (markupPct / 100);
  let totalFee = providerFee + markupFee;

  if (hardCapMultiplier > 0) {
    const cap = amount * hardCapMultiplier;
    totalFee = Math.min(totalFee, cap);
  }

  const rounded = (n: number) => Number(n.toFixed(6));
  const effectiveMultiplier = totalFee / amount;

  return json({
    success: true,
    data: {
      direction,
      channel,
      currency,
      amount: rounded(amount),
      product: PRODUCT,
      provider_fee: rounded(providerFee),
      markup_fee: rounded(markupFee),
      total_fee: rounded(totalFee),
      effective_multiplier: rounded(effectiveMultiplier),
      hard_cap_multiplier: hardCapMultiplier > 0 ? rounded(hardCapMultiplier) : null,
      pricing_version: PRICING_VERSION,
      quoted_at: new Date().toISOString(),
    },
  });
});
