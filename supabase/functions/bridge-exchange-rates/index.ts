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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const from = normalizeCurrency(body?.from);
  const to = normalizeCurrency(body?.to);
  if (!from || !to || from === to) {
    return json({ success: false, error: "from/to are required and must be different" }, 400);
  }

  const r = await bridgeFetch({
    method: "GET",
    path: "/v0/exchange_rates",
    query: { from, to },
  });

  if (!r.ok) {
    return json({
      success: false,
      error: r.error || `Bridge exchange rates failed (${r.status})`,
      request_id: r.request_id ?? null,
    }, r.status || 502);
  }

  const data: any = (r.data as any)?.data ?? r.data ?? {};
  const rate = Number(data?.rate ?? data?.exchange_rate ?? data?.from_to_rate ?? 0);
  const reverseRate = Number(data?.reverse_rate ?? data?.to_from_rate ?? 0);
  const updatedAt = data?.updated_at ?? data?.timestamp ?? null;

  if (!Number.isFinite(rate) || rate <= 0) {
    return json({ success: false, error: "Bridge exchange rate response missing valid rate" }, 502);
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

