import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  FlutterwaveCapabilities,
  getFlutterwaveCapabilities,
  getFlutterwaveLocalRailPolicy,
} from "../providers/flutterwave.ts";
import { getFlutterwaveStaticIpGuard } from "../providers/flutterwave-static-ip-guard.ts";

export type FlutterwaveAccountType = "individual" | "business";
export type FlutterwaveRailMode = "receive" | "payout" | "either";

export interface FlutterwaveRuntimeGateResult {
  allowed: boolean;
  status: number;
  body: Record<string, unknown>;
}

export function parseAccountType(value: unknown): FlutterwaveAccountType | null {
  const at = String(value || "individual").trim().toLowerCase();
  if (at === "individual" || at === "business") return at;
  return null;
}

export async function ensureBusinessProfileForAccountType(
  supa: SupabaseClient,
  userId: string,
  accountType: FlutterwaveAccountType,
): Promise<boolean> {
  if (accountType !== "business") return true;
  const { data } = await supa
    .from("business_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.id);
}

export function getRuntimeCapsAndPolicy() {
  const caps = getFlutterwaveCapabilities();
  const localRailPolicy = getFlutterwaveLocalRailPolicy();
  const staticIpGuard = getFlutterwaveStaticIpGuard();
  return { caps, localRailPolicy, staticIpGuard };
}

export function gateFlutterwaveRuntime(
  mode: FlutterwaveRailMode,
): FlutterwaveRuntimeGateResult & { caps: FlutterwaveCapabilities; staticIpGuard: ReturnType<typeof getFlutterwaveStaticIpGuard> } {
  const caps = getFlutterwaveCapabilities();
  const staticIpGuard = getFlutterwaveStaticIpGuard();

  if (!caps.configured) {
    return {
      allowed: false,
      status: 503,
      body: {
        success: false,
        code: "flutterwave_not_configured",
        error: "Flutterwave is not configured in this environment.",
        data: { capabilities: caps, static_ip_guard: staticIpGuard },
      },
      caps,
      staticIpGuard,
    };
  }

  if (mode === "receive" && !caps.receive_enabled) {
    return {
      allowed: false,
      status: 503,
      body: {
        success: false,
        code: "flutterwave_not_enabled",
        error: "Flutterwave collection rails are not enabled in this environment.",
        data: { capabilities: caps, static_ip_guard: staticIpGuard },
      },
      caps,
      staticIpGuard,
    };
  }

  if (mode === "payout" && !caps.payout_enabled) {
    return {
      allowed: false,
      status: 503,
      body: {
        success: false,
        code: "flutterwave_not_enabled",
        error: "Flutterwave payout rails are not enabled in this environment.",
        data: { capabilities: caps, static_ip_guard: staticIpGuard },
      },
      caps,
      staticIpGuard,
    };
  }

  if (mode === "either" && !(caps.receive_enabled || caps.payout_enabled)) {
    return {
      allowed: false,
      status: 503,
      body: {
        success: false,
        code: "flutterwave_not_enabled",
        error: "Flutterwave rails are not enabled in this environment.",
        data: { capabilities: caps, static_ip_guard: staticIpGuard },
      },
      caps,
      staticIpGuard,
    };
  }

  return {
    allowed: true,
    status: 200,
    body: { success: true },
    caps,
    staticIpGuard,
  };
}

export function validateCountryOnPolicy(
  country: string,
  supportedCountries: readonly string[],
): FlutterwaveRuntimeGateResult {
  const c = String(country || "").trim().toUpperCase();
  if (!c) return { allowed: true, status: 200, body: { success: true } };
  if (!/^[A-Z]{2}$/.test(c)) {
    return { allowed: false, status: 400, body: { success: false, error: "country format is invalid" } };
  }
  if (!supportedCountries.includes(c)) {
    return {
      allowed: false,
      status: 409,
      body: {
        success: false,
        code: "corridor_not_supported",
        error: "This country is not enabled on local rails.",
        data: { supported_countries: supportedCountries },
      },
    };
  }
  return { allowed: true, status: 200, body: { success: true } };
}

export function validateCurrencyOnPolicy(
  currency: string,
  supportedCurrencies: readonly string[],
): FlutterwaveRuntimeGateResult {
  const c = String(currency || "").trim().toUpperCase();
  if (!c) return { allowed: false, status: 400, body: { success: false, error: "currency is required" } };
  if (!/^[A-Z]{3,5}$/.test(c)) {
    return { allowed: false, status: 400, body: { success: false, error: "currency format is invalid" } };
  }
  if (!supportedCurrencies.includes(c)) {
    return {
      allowed: false,
      status: 409,
      body: {
        success: false,
        code: "corridor_not_supported",
        error: "Requested currency is not enabled on local rails.",
        data: { supported_currencies: supportedCurrencies },
      },
    };
  }
  return { allowed: true, status: 200, body: { success: true } };
}

