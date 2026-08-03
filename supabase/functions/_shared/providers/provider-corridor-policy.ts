import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isBridgeBlocked } from "./bridge-country-policy.ts";

export type CorridorChannel = "bank" | "mobile_money" | "wallet";
export type CorridorDirection = "receive" | "payout" | "fx";

export interface CorridorPolicyInput {
  provider: "bridge" | "flutterwave";
  direction: CorridorDirection;
  userCountry: string | null | undefined;
  destinationCountry: string | null | undefined;
  destinationCurrency: string | null | undefined;
  channel: CorridorChannel;
  bridgeVerified: boolean;
}

export interface CorridorPolicyDecision {
  allowed: boolean;
  code:
    | "ok"
    | "bridge_country_blocked"
    | "bridge_verification_required"
    | "corridor_not_enabled"
    | "policy_lookup_failed";
  message: string;
  policy?: CorridorPolicyRow | null;
}

export function isBridgeProfileVerified(profile: any): boolean {
  const accountStatus = String(profile?.bridge_account_status || "").toLowerCase();
  if (["active", "approved", "authorized"].includes(accountStatus)) return true;
  const accountType = String(profile?.account_type || "individual").toLowerCase();
  const status = String(
    accountType === "business" ? profile?.bridge_kyb_status : profile?.bridge_kyc_status || "",
  ).toLowerCase();
  return ["approved", "active", "authorized", "verified", "completed", "complete"].includes(status);
}

export interface CorridorPolicyRow {
  provider: "bridge" | "flutterwave";
  direction: CorridorDirection;
  country_code: string;
  source_currency: string | null;
  destination_currency: string | null;
  channel: CorridorChannel | null;
  enabled: boolean;
  requires_bridge_kyc: boolean;
  priority: number;
  notes: string | null;
}

export async function listProviderCorridors(
  supa: SupabaseClient,
  input: {
    provider: "bridge" | "flutterwave";
    direction?: CorridorDirection;
    countryCode?: string | null;
    enabledOnly?: boolean;
  },
): Promise<{ ok: true; rows: CorridorPolicyRow[] } | { ok: false; error: string }> {
  try {
    let q = supa
      .from("provider_corridor_policy")
      .select("*")
      .eq("provider", input.provider)
      .order("priority", { ascending: false });

    if (input.direction) q = q.eq("direction", input.direction);
    if (input.enabledOnly !== false) q = q.eq("enabled", true);
    if (input.countryCode) q = q.eq("country_code", String(input.countryCode).trim().toUpperCase());

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message || "policy_lookup_failed" };
    return { ok: true, rows: (Array.isArray(data) ? data : []) as CorridorPolicyRow[] };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || "policy_lookup_failed") };
  }
}

export async function isProviderCorridorEnabled(
  supa: SupabaseClient,
  input: {
    provider: "bridge" | "flutterwave";
    direction: CorridorDirection;
    countryCode: string;
    channel: CorridorChannel;
    destinationCurrency?: string | null;
  },
): Promise<{ enabled: boolean; code: "ok" | "corridor_not_enabled" | "policy_lookup_failed"; row?: CorridorPolicyRow | null }> {
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  if (!countryCode) return { enabled: false, code: "corridor_not_enabled", row: null };
  const destinationCurrency = String(input.destinationCurrency || "").trim().toUpperCase();
  const channel = String(input.channel || "").trim().toLowerCase() as CorridorChannel;

  const listed = await listProviderCorridors(supa, {
    provider: input.provider,
    direction: input.direction,
    countryCode,
    enabledOnly: true,
  });
  if (!listed.ok) return { enabled: false, code: "policy_lookup_failed", row: null };

  const match = listed.rows.find((r) => {
    const rowChannel = String(r.channel || "").trim().toLowerCase();
    const rowCurrency = String(r.destination_currency || "").trim().toUpperCase();
    const channelOk = !rowChannel || rowChannel === channel;
    const currencyOk = !rowCurrency || !destinationCurrency || rowCurrency === destinationCurrency;
    return channelOk && currencyOk;
  });

  if (!match) return { enabled: false, code: "corridor_not_enabled", row: null };
  return { enabled: true, code: "ok", row: match };
}

export async function evaluateProviderCorridorPolicy(
  supa: SupabaseClient,
  input: CorridorPolicyInput,
): Promise<CorridorPolicyDecision> {
  const userCountry = String(input.userCountry || "").trim().toUpperCase();
  const destinationCountry = String(input.destinationCountry || "").trim().toUpperCase();
  const destinationCurrency = String(input.destinationCurrency || "").trim().toUpperCase();
  const channel = String(input.channel || "").trim().toLowerCase() as CorridorChannel;

  if (!userCountry || isBridgeBlocked(userCountry)) {
    return {
      allowed: false,
      code: "bridge_country_blocked",
      message: "Your country is not currently eligible for this payout route.",
    };
  }

  if (!input.bridgeVerified) {
    return {
      allowed: false,
      code: "bridge_verification_required",
      message: "Please complete identity verification before using this payout route.",
    };
  }

  try {
    const listed = await listProviderCorridors(supa, {
      provider: input.provider,
      direction: input.direction,
      countryCode: destinationCountry,
      enabledOnly: true,
    });

    if (!listed.ok) {
      return {
        allowed: false,
        code: "policy_lookup_failed",
        message: "Unable to validate payout corridor policy right now.",
      };
    }

    const rows = listed.rows;
    const match = rows.find((r: any) => {
      const ccy = String(r.destination_currency || "").trim().toUpperCase();
      const ch = String(r.channel || "").trim().toLowerCase();
      const currencyOk = !ccy || ccy === destinationCurrency;
      const channelOk = !ch || ch === channel;
      return currencyOk && channelOk;
    });

    if (!match) {
      return {
        allowed: false,
        code: "corridor_not_enabled",
        message: "This payout corridor is not enabled for your account.",
      };
    }

    if (match.requires_bridge_kyc && !input.bridgeVerified) {
      return {
        allowed: false,
        code: "bridge_verification_required",
        message: "Please complete identity verification before using this payout route.",
        policy: match,
      };
    }

    return { allowed: true, code: "ok", message: "Corridor allowed", policy: match };
  } catch {
    return {
      allowed: false,
      code: "policy_lookup_failed",
      message: "Unable to validate payout corridor policy right now.",
    };
  }
}
