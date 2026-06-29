import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function normalizeCurrency(v: unknown): string {
  return String(v || "").trim().toUpperCase();
}

function mapExchangeRateProviderError(status: number, providerMessage?: string) {
  const msg = String(providerMessage || "").toLowerCase();
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      error: "Rate lookup is temporarily busy. Please retry in a moment.",
    };
  }
  if (status === 400 || msg.includes("unsupported") || msg.includes("invalid")) {
    return {
      status: 400,
      code: "unsupported_pair",
      error: "This currency pair is currently unavailable.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 502,
      code: "provider_auth_error",
      error: "Rate service is temporarily unavailable. Please try again shortly.",
    };
  }
  if (status >= 500 || status === 0) {
    return {
      status: 502,
      code: "provider_unavailable",
      error: "Unable to fetch exchange rates right now. Please retry shortly.",
    };
  }
  return {
    status: status || 502,
    code: "provider_error",
    error: "Unable to fetch exchange rates right now. Please retry.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const from = normalizeCurrency(body?.from);
  const to = normalizeCurrency(body?.to);
  if (!from || !to || from === to) {
    return json({
      success: false,
      code: "invalid_pair_input",
      error: "Source and destination currencies are required and must be different.",
      from: from || null,
      to: to || null,
    }, 400);
  }

  const r = await bridgeFetch({
    method: "GET",
    path: "/v0/exchange_rates",
    query: { from, to },
  });

  if (!r.ok) {
    const mapped = mapExchangeRateProviderError(r.status, r.error);
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      request_id: r.request_id ?? null,
    }, mapped.status);
  }

  const data: any = (r.data as any)?.data ?? r.data ?? {};
  const rate = Number(data?.rate ?? data?.exchange_rate ?? data?.from_to_rate ?? 0);
  const reverseRate = Number(data?.reverse_rate ?? data?.to_from_rate ?? 0);
  const updatedAt = data?.updated_at ?? data?.timestamp ?? null;

  if (!Number.isFinite(rate) || rate <= 0) {
    return json({
      success: false,
      code: "invalid_rate_payload",
      error: "Exchange rate is temporarily unavailable. Please retry.",
    }, 502);
  }

  return json({
    success: true,
    data: {
      from,
      to,
      rate,
      reverse_rate: Number.isFinite(reverseRate) && reverseRate > 0 ? reverseRate : null,
      updated_at: updatedAt,
      provider: "bridge",
    },
  });
});
