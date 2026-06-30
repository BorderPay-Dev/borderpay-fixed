import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getFlutterwaveCapabilities,
  getFlutterwaveLocalRailPolicy,
  flutterwaveHealthCheck,
  flutterwaveListBanks,
  flutterwaveListMobileNetworks,
  flutterwaveListPaymentMethods,
} from "../_shared/providers/flutterwave.ts";

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

type Action = "health" | "payment_methods" | "banks" | "mobile_networks" | "corridor_policy";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = String(body?.action || "health").trim() as Action;
  const caps = getFlutterwaveCapabilities();

  if (!caps.configured) {
    return json({
      success: false,
      code: "flutterwave_not_configured",
      error: "Flutterwave is not configured in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  if (action === "health") {
    const res = await flutterwaveHealthCheck();
    return json({
      success: res.ok,
      code: res.ok ? "ok" : "upstream_unhealthy",
      error: res.ok ? undefined : (res.error || "Flutterwave healthcheck failed"),
      data: {
        capabilities: caps,
        provider_status: {
          http_status: res.status,
          request_id: res.requestId || null,
        },
      },
    }, res.ok ? 200 : 502);
  }

  if (action === "payment_methods") {
    const country = String(body?.country || "").trim().toUpperCase();
    const res = await flutterwaveListPaymentMethods(country || undefined);
    if (!res.ok) return json({ success: false, error: res.error || "Failed to load payment methods", data: { capabilities: caps } }, 502);
    return json({ success: true, data: { capabilities: caps, payment_methods: res.data } });
  }

  if (action === "banks") {
    const country = String(body?.country || "").trim().toUpperCase();
    if (!country) return json({ success: false, error: "country is required" }, 400);
    const res = await flutterwaveListBanks(country);
    if (!res.ok) return json({ success: false, error: res.error || "Failed to load banks", data: { capabilities: caps } }, 502);
    return json({ success: true, data: { capabilities: caps, country, banks: res.data } });
  }

  if (action === "mobile_networks") {
    const country = String(body?.country || "").trim().toUpperCase();
    if (!country) return json({ success: false, error: "country is required" }, 400);
    const res = await flutterwaveListMobileNetworks(country);
    if (!res.ok) return json({ success: false, error: res.error || "Failed to load mobile networks", data: { capabilities: caps } }, 502);
    return json({ success: true, data: { capabilities: caps, country, mobile_networks: res.data } });
  }

  if (action === "corridor_policy") {
    return json({
      success: true,
      data: {
        capabilities: caps,
        local_rail_policy: getFlutterwaveLocalRailPolicy(),
      },
    });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});

