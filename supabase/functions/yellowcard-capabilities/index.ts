import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isAfricanRailsTesterEmail } from "../_shared/african-rails-access.ts";
import { listYellowCardCommercialRails, normalizeYellowCardCountryCode } from "../_shared/providers/yellowcard-commercial-policy.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import {
  mergeYellowCardRows,
  resolveYellowCardRouting,
  yellowCardProviderChannelType,
} from "../_shared/providers/yellowcard-routing.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, code: "authorization_required", error: "Authorization required" }, 401);
  const { data: authData, error: authError } = await supa.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.id) return json({ success: false, code: "unauthorized", error: "Unauthorized" }, 401);
  if (!isAfricanRailsTesterEmail(user.email)) {
    return json({ success: false, code: "african_rails_closed_beta", error: "Yellow Card integration testing is restricted." }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ success: false, code: "invalid_json" }, 400); }
  const action = String(body?.action || "corridor_policy").trim().toLowerCase();
  const country = String(body?.country || "").trim().toUpperCase();
  const currency = String(body?.currency || "").trim().toUpperCase();
  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "sandbox") {
    return json({ success: false, code: "yellow_card_sandbox_unavailable", error: "African rails testing is unavailable." }, 503);
  }
  if (action === "corridor_policy") {
    const direction = String(body?.direction || "receive").trim().toLowerCase();
    const testerAllReceiveCountries = direction === "receive" && isAfricanRailsTesterEmail(user.email);
    if (direction !== "receive" && direction !== "payout") {
      return json({ success: false, code: "unsupported_direction" }, 400);
    }
    let profileCountry = "";
    if (direction === "receive") {
      const { data: profile, error: profileError } = await supa
        .from("user_profiles")
        .select("country")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) return json({ success: false, code: "profile_country_lookup_failed" }, 503);
      profileCountry = normalizeYellowCardCountryCode(profile?.country);
      if (!testerAllReceiveCountries && !/^[A-Z]{2}$/.test(profileCountry)) {
        return json({ success: true, data: { local_rail_policy: {
          provider: "yellow_card", direction, source: "yellow_card_commercial_team_document_2026",
          eligibility: "account_country_only", account_country: null, rows: [],
        } } });
      }
    }
    const commercialRows = listYellowCardCommercialRails(
      direction as "receive" | "payout",
      direction === "receive" && !testerAllReceiveCountries ? profileCountry : null,
    );
    // Keep the signed commercial schedule visible in the sandbox catalogue.
    // Provider discovery is retained as diagnostics and is re-checked when a
    // tester selects a corridor; it must not silently shrink the 21-country,
    // 28-rail test matrix when Yellow Card omits sandbox network metadata.
    const publicRows = commercialRows;
    return json({ success: true, data: { local_rail_policy: {
      provider: "yellow_card",
      direction,
      source: "yellow_card_commercial_team_document_2026",
      source_document_date: "2026-07-08",
      eligibility: testerAllReceiveCountries
        ? "integration_tester_all_receive_countries"
        : direction === "receive" ? "account_country_only" : "global_sender",
      account_country: direction === "receive" ? profileCountry : null,
      rows: publicRows,
      discovery_status: "deferred_until_corridor_selection",
      discovery_error: null,
      unavailable_rows: [],
    } } });
  }
  if (action === "routing") {
    const direction = String(body?.direction || "payout").trim().toLowerCase();
    const rail = String(body?.channel || "").trim().toLowerCase();
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency) ||
      !["receive", "payout"].includes(direction) || !["bank", "mobile_money"].includes(rail)) {
      return json({ success: false, code: "yellow_card_invalid_routing_request" }, 400);
    }
    const signed = listYellowCardCommercialRails(direction as "receive" | "payout", country).some((row) =>
      row.destination_currency === currency && row.channel === rail
    );
    if (!signed) return json({ success: false, code: "yellow_card_commercial_corridor_unavailable" }, 403);
    const channelsResult = await yellowCardFetch({ method: "GET", path: "/channels", query: { country } });
    if (!channelsResult.ok) {
      return json({
        success: false,
        code: channelsResult.error || "yellow_card_routing_discovery_failed",
        error: "Unable to load available payout rails.",
      }, 502);
    }
    const channelOnly = resolveYellowCardRouting({
      channels: channelsResult.data,
      networks: [],
      direction: direction as "receive" | "payout",
      country,
      currency,
      rail: rail as "bank" | "mobile_money",
    });
    const networkResults = await Promise.all([
      yellowCardFetch({ method: "GET", path: "/networks", query: { country } }),
      ...channelOnly.channels.filter((channel) => String(channel?.id || "").trim()).map((channel) => yellowCardFetch({
        method: "GET",
        path: "/networks",
        query: { country, channelId: String(channel?.id || "") },
      })),
    ]);
    const successfulNetworkPayloads = networkResults.filter((result) => result.ok).map((result) => result.data);
    if (successfulNetworkPayloads.length === 0) {
      return json({ success: false, code: networkResults[0]?.error || "yellow_card_routing_discovery_failed", error: "Unable to load available payout rails." }, 502);
    }
    const mergedNetworks = mergeYellowCardRows(successfulNetworkPayloads, "networks");
    const routing = resolveYellowCardRouting({
      channels: channelsResult.data,
      networks: mergedNetworks,
      direction: direction as "receive" | "payout",
      country,
      currency,
      rail: rail as "bank" | "mobile_money",
    });
    const networkRequired = direction === "payout" || rail === "mobile_money";
    return json({ success: true, data: { routing: {
      available: routing.channelAvailable && (!networkRequired || routing.networkAvailable),
      channel_type: yellowCardProviderChannelType(rail as "bank" | "mobile_money"),
      channels: routing.channels.map((row) => ({
        id: String(row?.id || ""),
        minimum: row?.min ?? null,
        maximum: row?.max ?? null,
      })),
      networks: routing.networks.map((row) => ({
        id: String(row?.id || ""),
        name: String(row?.name || row?.code || "Payment network"),
        code: String(row?.code || ""),
        accountNumberType: String(row?.accountNumberType || ""),
        status: String(row?.status || row?.apiStatus || "active"),
      })),
    } } });
  }
  const paths: Record<string, { path: string; query?: Record<string, string> }> = {
    channels: { path: "/channels", query: country ? { country } : undefined },
    networks: { path: "/networks", query: country ? { country } : undefined },
    rates: { path: "/rates", query: currency ? { currency } : undefined },
  };
  const selected = paths[action];
  if (!selected) return json({ success: false, code: "unsupported_action" }, 400);
  const res = await yellowCardFetch({ method: "GET", ...selected });
  return json({ success: res.ok, code: res.ok ? "ok" : res.error, data: { [action]: res.data } }, res.ok ? 200 : 502);
});
