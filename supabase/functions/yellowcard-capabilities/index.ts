import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateVerifiedAfricanRailsUser } from "../_shared/african-rails-access.ts";
import { listYellowCardCommercialRails, normalizeYellowCardCountryCode } from "../_shared/providers/yellowcard-commercial-policy.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import {
  resolveYellowCardRouting,
  yellowCardProviderChannelType,
} from "../_shared/providers/yellowcard-routing.ts";
import { yellowCardDestinationAmount } from "../_shared/providers/yellowcard-rate.ts";

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

const discoveryCache = new Map<string, { expiresAt: number; data: unknown }>();
const discoveryInFlight = new Map<string, Promise<unknown>>();

async function cachedDiscovery(key: string, ttlMs: number, load: () => Promise<any>) {
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) discoveryCache.delete(key);
  const pending = discoveryInFlight.get(key);
  if (pending) return pending;
  const request = load().then((data) => {
    if (data?.ok) discoveryCache.set(key, { expiresAt: Date.now() + ttlMs, data });
    return data;
  }).finally(() => discoveryInFlight.delete(key));
  discoveryInFlight.set(key, request);
  return request;
}

function rows(value: any, key: string): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.[key])) return value.data[key];
  return [];
}

function normalizedRate(payload: any, currency: string, direction: string) {
  const row = rows(payload, "rates").find((item) =>
    String(item?.code || item?.currency || "").trim().toUpperCase() === currency
  );
  if (!row) return null;
  // Yellow Card quotes local currency per USD. Payouts use the sell side;
  // collections use the buy side. Keep the raw row for audit evidence.
  const value = Number(direction === "receive" ? row?.buy : row?.sell);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    rate: value,
    currency,
    side: direction === "receive" ? "buy" : "sell",
    updated_at: row?.updatedAt || null,
    raw: row,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const access = await authenticateVerifiedAfricanRailsUser(supa, req);
  if (!access.allowed) return json({ success: false, code: access.code, error: access.message }, access.status);
  const user = access.user;

  let body: any = {};
  try { body = await req.json(); } catch { return json({ success: false, code: "invalid_json" }, 400); }
  const action = String(body?.action || "corridor_policy").trim().toLowerCase();
  const country = String(body?.country || "").trim().toUpperCase();
  const currency = String(body?.currency || "").trim().toUpperCase();
  const config = getYellowCardConfig();
  if (!config.configured || config.environment !== "production" || config.production_enabled !== true) {
    return json({ success: false, code: "yellow_card_production_unavailable", error: "Yellow Card production discovery is unavailable." }, 503);
  }
  if (action === "corridor_policy") {
    const direction = String(body?.direction || "receive").trim().toLowerCase();
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
      if (!/^[A-Z]{2}$/.test(profileCountry)) {
        return json({ success: true, data: { local_rail_policy: {
          provider: "yellow_card", direction, source: "yellow_card_commercial_team_document_2026",
          eligibility: "account_country_only", account_country: null, rows: [],
        } } });
      }
    }
    const commercialRows = listYellowCardCommercialRails(
      direction as "receive" | "payout",
      direction === "receive" ? profileCountry : null,
    );
    // The commercial schedule defines what BorderPay is permitted to offer.
    // Yellow Card's live Channels response defines what is operational now.
    // Expose only the intersection so a disabled rail is never shown or
    // submitted. One discovery call covers the selected receive country or
    // the complete payout map and avoids per-corridor request fan-out.
    const coverageCountry = direction === "receive" ? profileCountry : "";
    const coverageResult: any = await cachedDiscovery(
      `coverage:channels:${direction}:${coverageCountry || "all"}`,
      5 * 60_000,
      () => yellowCardFetch({
        method: "GET",
        path: "/channels",
        query: coverageCountry ? { country: coverageCountry } : undefined,
      }),
    );
    if (!coverageResult?.ok) {
      return json({
        success: false,
        code: coverageResult?.error || "yellow_card_coverage_unavailable",
        error: "Live Yellow Card corridor coverage is unavailable.",
      }, 502);
    }
    const publicRows = commercialRows.filter((row) => resolveYellowCardRouting({
      channels: coverageResult.data,
      networks: [],
      direction: row.direction,
      country: row.country_code,
      currency: row.destination_currency,
      rail: row.channel,
    }).channelAvailable);
    const unavailableRows = commercialRows.filter((row) => !publicRows.includes(row));
    return json({ success: true, data: { local_rail_policy: {
      provider: "yellow_card",
      direction,
      source: "yellow_card_commercial_schedule_intersect_live_channels",
      source_document_date: "2026-07-08",
      eligibility: direction === "receive" ? "account_country_only" : "global_sender",
      account_country: direction === "receive" ? profileCountry : null,
      rows: publicRows,
      discovery_status: "live_coverage_verified",
      discovery_error: null,
      unavailable_rows: unavailableRows,
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
    const [channelsResult, networksResult]: any[] = await Promise.all([
      cachedDiscovery(`channels:${country}`, 5 * 60_000, () => yellowCardFetch({ method: "GET", path: "/channels", query: { country } })),
      cachedDiscovery(`networks:${country}`, 5 * 60_000, () => yellowCardFetch({ method: "GET", path: "/networks", query: { country } })),
    ]);
    if (!channelsResult.ok) {
      return json({
        success: false,
        code: channelsResult.error || "yellow_card_routing_discovery_failed",
        error: "Unable to load available payout rails.",
      }, 502);
    }
    // Yellow Card's published Networks contract supports country filtering.
    // Do not fan out undocumented channelId requests: that multiplies provider
    // calls per screen and can rate-limit every corridor during sandbox review.
    if (!networksResult.ok) {
      return json({ success: false, code: networksResult.error || "yellow_card_routing_discovery_failed", error: "Unable to load available payout rails." }, 502);
    }
    const routing = resolveYellowCardRouting({
      channels: channelsResult.data,
      networks: networksResult.data,
      direction: direction as "receive" | "payout",
      country,
      currency,
      rail: rail as "bank" | "mobile_money",
    });
    const networkRequired = direction === "payout" || rail === "mobile_money";
    const availabilityReason = !routing.channelAvailable
      ? "provider_channel_unavailable"
      : networkRequired && !routing.networkAvailable
        ? "provider_network_unavailable_or_unlinked"
        : null;
    return json({ success: true, data: { routing: {
      available: routing.channelAvailable && (!networkRequired || routing.networkAvailable),
      availability_reason: availabilityReason,
      provider_environment: config.environment,
      provider_transport: config.transport,
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
        channelIds: Array.isArray(row?.channelIds) ? row.channelIds.map((id: unknown) => String(id || "")).filter(Boolean) : [],
      })),
    } } });
  }
  if (action === "quote") {
    const direction = String(body?.direction || "payout").trim().toLowerCase();
    const amount = Number(body?.amount);
    if (!/^[A-Z]{3}$/.test(currency) || !["receive", "payout"].includes(direction) || !Number.isFinite(amount) || amount <= 0) {
      return json({ success: false, code: "yellow_card_invalid_quote_request" }, 400);
    }
    const res: any = await cachedDiscovery(`rates:${currency}`, 30_000, () =>
      yellowCardFetch({ method: "GET", path: "/rates", query: { currency }, timeoutMs: 10_000 })
    );
    if (!res.ok) return json({ success: false, code: res.error || "yellow_card_rate_unavailable", error: "Unable to load the current exchange rate." }, 502);
    const quote = normalizedRate(res.data, currency, direction);
    if (!quote) return json({ success: false, code: "yellow_card_rate_missing", error: "The current exchange rate is unavailable." }, 502);
    return json({ success: true, data: { quote: {
      ...quote,
      source_amount: amount,
      destination_amount: yellowCardDestinationAmount(amount, quote.rate, direction as "receive" | "payout"),
      source_currency: direction === "receive" ? currency : "USD",
      destination_currency: direction === "receive" ? "USD" : currency,
    } } });
  }
  const paths: Record<string, { path: string; query?: Record<string, string> }> = {
    channels: { path: "/channels", query: country ? { country } : undefined },
    networks: { path: "/networks", query: country ? { country } : undefined },
    rates: { path: "/rates", query: currency ? { currency } : undefined },
  };
  const selected = paths[action];
  if (!selected) return json({ success: false, code: "unsupported_action" }, 400);
  const ttlMs = action === "rates" ? 30_000 : 5 * 60_000;
  const cacheScope = action === "rates" ? currency : country;
  const res: any = await cachedDiscovery(`${action}:${cacheScope}`, ttlMs, () => yellowCardFetch({ method: "GET", ...selected, timeoutMs: action === "rates" ? 10_000 : undefined }));
  return json({ success: res.ok, code: res.ok ? "ok" : res.error, data: { [action]: res.data } }, res.ok ? 200 : 502);
});
