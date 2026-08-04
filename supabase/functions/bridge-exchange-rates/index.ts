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

const DISPLAY_PAIRS = new Set([
  "USD_USDC",
  "USD_USDT",
  "EUR_USDC",
  "EUR_USDT",
  "GBP_USDC",
  "GBP_USDT",
]);
const CACHE_TTL_MS = 30_000;
const rateCache = new Map<string, { expiresAt: number; value: Record<string, unknown> }>();

async function loadRate(from: string, to: string) {
  const key = `${from}_${to}`;
  const cached = rateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ok: true as const, data: cached.value };

  const response = await bridgeFetch({
    method: "GET",
    path: "/v0/exchange_rates",
    query: { from, to },
  });
  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status || 502,
      error: response.error || `Reference rate unavailable (${response.status})`,
      requestId: response.request_id ?? null,
    };
  }

  const raw: any = (response.data as any)?.data ?? response.data ?? {};
  const rate = Number(raw?.rate ?? raw?.exchange_rate ?? raw?.from_to_rate ?? 0);
  const reverseRate = Number(raw?.reverse_rate ?? raw?.to_from_rate ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false as const, status: 502, error: "Reference rate unavailable", requestId: response.request_id ?? null };
  }

  const value = {
    from,
    to,
    rate,
    reverse_rate: Number.isFinite(reverseRate) && reverseRate > 0 ? reverseRate : null,
    updated_at: raw?.updated_at ?? raw?.timestamp ?? null,
  };
  rateCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return { ok: true as const, data: value };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const requested: Array<{ from: string; to: string }> = Array.isArray(body?.pairs)
    ? body.pairs.map((pair: any) => ({ from: normalizeCurrency(pair?.from), to: normalizeCurrency(pair?.to) }))
    : [{ from: normalizeCurrency(body?.from), to: normalizeCurrency(body?.to) }];

  if (requested.length < 1 || requested.length > DISPLAY_PAIRS.size) {
    return json({ success: false, error: "One to six reference-rate pairs are required" }, 400);
  }
  if (requested.some(({ from, to }: { from: string; to: string }) => !from || !to || from === to || !DISPLAY_PAIRS.has(`${from}_${to}`))) {
    return json({ success: false, error: "One or more reference-rate pairs are unavailable" }, 400);
  }

  const unique: Array<{ from: string; to: string }> = Array.from(
    new Map<string, { from: string; to: string }>(
      requested.map((pair) => [`${pair.from}_${pair.to}`, pair]),
    ).values(),
  );
  const results = await Promise.all(unique.map(({ from, to }) => loadRate(from, to)));
  if (Array.isArray(body?.pairs)) {
    return json({
      success: true,
      data: {
        rates: results.map((result, index) => result.ok
          ? result.data
          : { ...unique[index], rate: null, updated_at: null, unavailable: true }),
      },
    });
  }

  const [{ from, to }] = unique;
  const [result] = results;
  if (!result.ok) {
    return json({ success: false, error: result.error, request_id: result.requestId }, result.status);
  }
  return json({ success: true, data: result.data });
});
