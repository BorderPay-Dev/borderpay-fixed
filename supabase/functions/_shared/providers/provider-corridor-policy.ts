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
  policy?: Record<string, unknown> | null;
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
    const { data, error } = await supa
      .from("provider_corridor_policy")
      .select("*")
      .eq("provider", input.provider)
      .eq("direction", input.direction)
      .eq("country_code", destinationCountry)
      .eq("enabled", true)
      .order("priority", { ascending: false });

    if (error) {
      return {
        allowed: false,
        code: "policy_lookup_failed",
        message: "Unable to validate payout corridor policy right now.",
      };
    }

    const rows = Array.isArray(data) ? data : [];
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
