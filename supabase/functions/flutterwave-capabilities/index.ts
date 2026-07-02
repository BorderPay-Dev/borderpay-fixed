import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveHealthCheck,
  flutterwaveListBanks,
  flutterwaveListMobileNetworks,
  flutterwaveListPaymentMethods,
} from "../_shared/providers/flutterwave.ts";
import { mapFlutterwaveErrorResponse } from "../_shared/providers/flutterwave-error-response.ts";
import {
  gateFlutterwaveRuntime,
  getRuntimeCapsAndPolicy,
  validateCountryOnPolicy,
} from "../_shared/services/flutterwave-runtime.ts";

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
const ALLOWED_ACTIONS: Action[] = ["health", "payment_methods", "banks", "mobile_networks", "corridor_policy"];

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

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

  const action = String(body?.action || "health").trim().toLowerCase() as Action;
  if (!ALLOWED_ACTIONS.includes(action)) {
    return json({
      success: false,
      code: "invalid_action",
      error: "Unsupported action",
      data: { allowed_actions: ALLOWED_ACTIONS },
    }, 400);
  }
  const { caps, staticIpGuard, localRailPolicy } = getRuntimeCapsAndPolicy();

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
    const mapped = !res.ok ? mapFlutterwaveErrorResponse(res.error, res.error || "Flutterwave healthcheck failed") : null;
    return json({
      success: res.ok,
      code: res.ok ? "ok" : (mapped?.code || "upstream_unhealthy"),
      error: res.ok ? undefined : (mapped?.error || "Flutterwave healthcheck failed"),
      data: {
        capabilities: caps,
        provider_status: {
          http_status: res.status,
          request_id: res.requestId || null,
        },
        static_ip_guard: staticIpGuard,
      },
    }, res.ok ? 200 : (mapped?.status || 502));
  }

  if (action === "corridor_policy") {
    return json({
      success: true,
      data: {
        capabilities: caps,
        static_ip_guard: staticIpGuard,
        local_rail_policy: localRailPolicy,
      },
    });
  }

  const railsGate = gateFlutterwaveRuntime("either");
  if (!railsGate.allowed) return json(railsGate.body, railsGate.status);
  const supportedCountries = localRailPolicy.countries as readonly string[];

  if (action === "payment_methods") {
    const country = String(body?.country || "").trim().toUpperCase();
    if (country) {
      const countryPolicy = validateCountryOnPolicy(country, supportedCountries);
      if (!countryPolicy.allowed) return json(countryPolicy.body, countryPolicy.status);
    }
    const res = await flutterwaveListPaymentMethods(country || undefined);
    if (!res.ok) {
      const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to load payment methods");
      return json({ success: false, code: mapped.code, error: mapped.error, data: { capabilities: caps } }, mapped.status);
    }
    return json({ success: true, data: { capabilities: caps, static_ip_guard: staticIpGuard, payment_methods: res.data } });
  }

  if (action === "banks") {
    const country = String(body?.country || "").trim().toUpperCase();
    if (!country) return json({ success: false, error: "country is required" }, 400);
    const countryPolicy = validateCountryOnPolicy(country, supportedCountries);
    if (!countryPolicy.allowed) return json(countryPolicy.body, countryPolicy.status);
    const res = await flutterwaveListBanks(country);
    if (!res.ok) {
      const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to load banks");
      return json({ success: false, code: mapped.code, error: mapped.error, data: { capabilities: caps } }, mapped.status);
    }
    return json({ success: true, data: { capabilities: caps, static_ip_guard: staticIpGuard, country, banks: res.data } });
  }

  if (action === "mobile_networks") {
    const country = String(body?.country || "").trim().toUpperCase();
    if (!country) return json({ success: false, error: "country is required" }, 400);
    const countryPolicy = validateCountryOnPolicy(country, supportedCountries);
    if (!countryPolicy.allowed) return json(countryPolicy.body, countryPolicy.status);
    const res = await flutterwaveListMobileNetworks(country);
    if (!res.ok) {
      const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to load mobile networks");
      return json({ success: false, code: mapped.code, error: mapped.error, data: { capabilities: caps } }, mapped.status);
    }
    return json({ success: true, data: { capabilities: caps, static_ip_guard: staticIpGuard, country, mobile_networks: res.data } });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});
