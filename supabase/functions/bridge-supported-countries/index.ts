import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";
import { isBridgeBlocked } from "../_shared/providers/bridge-country-policy.ts";
import { isoCountryCode2 } from "../_shared/iso-country-codes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function getCode2(input: unknown): string | null {
  const value = String(input ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

function getCode3(input: unknown): string | null {
  const value = String(input ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["data", "countries", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as any[];
    }
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "GET",
    }, 405);
  }

  const providerRes = await bridgeFetch({
    method: "GET",
    path: "/v0/lists/countries",
  });

  if (!providerRes.ok) {
    return json({
      success: false,
      code: "bridge_countries_unavailable",
      error: "Supported countries are temporarily unavailable.",
      bridge_request_id: providerRes.request_id ?? null,
    }, 502);
  }

  const raw = asArray(providerRes.data);
  const countries = raw
    .map((row: any) => {
      const name = String(
        row?.name ??
        row?.country_name ??
        row?.country ??
        row?.display_name ??
        "",
      ).trim();
      const code2 =
        getCode2(row?.alpha2) ??
        getCode2(row?.alpha_2) ??
        getCode2(row?.iso2) ??
        getCode2(row?.iso_2) ??
        getCode2(row?.country_code_alpha2) ??
        getCode2(row?.country_code) ??
        getCode2(row?.code) ??
        isoCountryCode2(
          row?.alpha3 ?? row?.alpha_3 ?? row?.iso3 ?? row?.iso_3 ??
          row?.country_code_alpha3 ?? row?.code,
        ) ??
        null;
      const code3 =
        getCode3(row?.alpha3) ??
        getCode3(row?.alpha_3) ??
        getCode3(row?.iso3) ??
        getCode3(row?.iso_3) ??
        getCode3(row?.country_code_alpha3) ??
        (code2 ? null : getCode3(row?.code));
      // Bridge's /lists/countries is a reference list, not an eligibility
      // guarantee. Apply the published Bridge compliance policy server-side.
      if (!code2 || isBridgeBlocked(code2)) return null;
      return {
        code: code2,
        code3,
        name,
      };
    })
    .filter(Boolean);

  return json({
    success: true,
    code: "bridge_supported_countries_ready",
    summary: {
      code: "bridge_supported_countries_ready",
      provider: "bridge",
      country_count: countries.length,
    },
    data: {
      provider: "bridge",
      countries,
    },
  });
});
