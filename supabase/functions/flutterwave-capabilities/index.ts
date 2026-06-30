import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  getFlutterwaveCapabilities,
  getFlutterwaveNetworkGuard,
  flutterwaveHealthCheck,
  flutterwaveListBanks,
  flutterwaveListMobileNetworks,
  flutterwaveListPaymentMethods,
} from "../_shared/providers/flutterwave.ts";
import { isProviderCorridorEnabled, listProviderCorridors } from "../_shared/providers/provider-corridor-policy.ts";

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
  const readGuard = getFlutterwaveNetworkGuard("read");
  const moneyMovementGuard = getFlutterwaveNetworkGuard("money_movement");

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
        network_guard: {
          read: readGuard,
          money_movement: moneyMovementGuard,
        },
      },
    }, res.ok ? 200 : 502);
  }

  if (action === "payment_methods") {
    const country = String(body?.country || "").trim().toUpperCase();
    if (country) {
      const bank = await isProviderCorridorEnabled(supa, {
        provider: "flutterwave",
        direction: "payout",
        countryCode: country,
        channel: "bank",
      });
      const momo = await isProviderCorridorEnabled(supa, {
        provider: "flutterwave",
        direction: "payout",
        countryCode: country,
        channel: "mobile_money",
      });
      if (!bank.enabled && !momo.enabled) {
        const code = bank.code === "policy_lookup_failed" || momo.code === "policy_lookup_failed"
          ? "policy_lookup_failed"
          : "corridor_not_enabled";
        return json({
          success: false,
          code,
          error: code === "policy_lookup_failed"
            ? "Unable to validate corridor policy right now."
            : "This corridor is not enabled.",
        }, code === "policy_lookup_failed" ? 503 : 403);
      }
    }
    const res = await flutterwaveListPaymentMethods(country || undefined);
    if (!res.ok) return json({ success: false, error: res.error || "Failed to load payment methods", data: { capabilities: caps } }, 502);
    return json({ success: true, data: { capabilities: caps, payment_methods: res.data } });
  }

  if (action === "banks") {
    const country = String(body?.country || "").trim().toUpperCase();
    const destinationCurrency = String(body?.destination_currency || "").trim().toUpperCase();
    if (!country) return json({ success: false, error: "country is required" }, 400);
    const corridor = await isProviderCorridorEnabled(supa, {
      provider: "flutterwave",
      direction: "payout",
      countryCode: country,
      channel: "bank",
      destinationCurrency: destinationCurrency || undefined,
    });
    if (!corridor.enabled) {
      return json({
        success: false,
        code: corridor.code,
        error: corridor.code === "policy_lookup_failed"
          ? "Unable to validate corridor policy right now."
          : "Bank payout corridor is not enabled for this country.",
      }, corridor.code === "policy_lookup_failed" ? 503 : 403);
    }
    const res = await flutterwaveListBanks(country);
    if (!res.ok) return json({ success: false, error: res.error || "Failed to load banks", data: { capabilities: caps } }, 502);
    return json({ success: true, data: { capabilities: caps, country, banks: res.data } });
  }

  if (action === "mobile_networks") {
    const country = String(body?.country || "").trim().toUpperCase();
    const destinationCurrency = String(body?.destination_currency || "").trim().toUpperCase();
    if (!country) return json({ success: false, error: "country is required" }, 400);
    const corridor = await isProviderCorridorEnabled(supa, {
      provider: "flutterwave",
      direction: "payout",
      countryCode: country,
      channel: "mobile_money",
      destinationCurrency: destinationCurrency || undefined,
    });
    if (!corridor.enabled) {
      return json({
        success: false,
        code: corridor.code,
        error: corridor.code === "policy_lookup_failed"
          ? "Unable to validate corridor policy right now."
          : "Mobile money payout corridor is not enabled for this country.",
      }, corridor.code === "policy_lookup_failed" ? 503 : 403);
    }
    const res = await flutterwaveListMobileNetworks(country);
    if (!res.ok) return json({ success: false, error: res.error || "Failed to load mobile networks", data: { capabilities: caps } }, 502);
    return json({ success: true, data: { capabilities: caps, country, mobile_networks: res.data } });
  }

  if (action === "corridor_policy") {
    const rows = await listProviderCorridors(supa, {
      provider: "flutterwave",
      direction: "payout",
      enabledOnly: true,
    });
    if (!rows.ok) {
      return json({
        success: false,
        code: "policy_lookup_failed",
        error: "Unable to load corridor policy right now.",
      }, 503);
    }

    const countries = [...new Set(rows.rows.map((r) => String(r.country_code || "").trim().toUpperCase()).filter(Boolean))];
    const channels = [...new Set(rows.rows.map((r) => String(r.channel || "").trim().toLowerCase()).filter(Boolean))];
    const currencies = [...new Set(rows.rows.map((r) => String(r.destination_currency || "").trim().toUpperCase()).filter(Boolean))];

    return json({
      success: true,
      data: {
        capabilities: caps,
        local_rail_policy: {
          countries,
          currencies,
          methods: channels,
          rows: rows.rows,
        },
      },
    });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});
