/**
 * Flutterwave adapter (backend scaffolding only).
 *
 * Purpose:
 * - Provide a typed internal interface for local rails (bank/mobile money)
 * - Keep all provider HTTP details inside shared adapter code
 * - No UI coupling and no production routing switch in this file
 */

import { flutterwaveClientConfigured, flutterwaveFetch } from "./flutterwave-client.ts";

export interface FlutterwaveCapabilities {
  configured: boolean;
  receive_enabled: boolean;
  payout_enabled: boolean;
  base_url: string;
}

function envEnabled(name: string): boolean {
  return (Deno.env.get(name) || "").toLowerCase() === "true";
}

export function getFlutterwaveCapabilities(): FlutterwaveCapabilities {
  return {
    configured: flutterwaveClientConfigured(),
    receive_enabled: envEnabled("FLW_RECEIVE_ENABLED"),
    payout_enabled: envEnabled("FLW_PAYOUT_ENABLED"),
    base_url: (Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com").replace(/\/+$/, ""),
  };
}

export async function flutterwaveHealthCheck() {
  // Non-destructive endpoint used for connectivity checks.
  return flutterwaveFetch({
    method: "GET",
    path: "/v3/payment-methods",
  });
}

export async function flutterwaveListPaymentMethods(country?: string) {
  return flutterwaveFetch({
    method: "GET",
    path: "/v3/payment-methods",
    query: country ? { country } : undefined,
  });
}

export async function flutterwaveListBanks(country: string) {
  return flutterwaveFetch({
    method: "GET",
    path: "/v3/banks",
    query: { country },
  });
}

export async function flutterwaveListMobileNetworks(country: string) {
  return flutterwaveFetch({
    method: "GET",
    path: "/v3/mobile-networks",
    query: { country },
  });
}

export async function flutterwaveGetTransferRates(input: {
  source_currency: string;
  destination_currency: string;
  amount?: string | number;
}) {
  return flutterwaveFetch({
    method: "GET",
    path: "/v3/transfers/rates",
    query: {
      source_currency: input.source_currency,
      destination_currency: input.destination_currency,
      amount: input.amount,
    },
  });
}

export async function verifyFlutterwaveWebhookSignature(headers: Headers): Promise<boolean> {
  // Flutterwave commonly sends `verif-hash`; keep this in env and compare.
  const expected = String(Deno.env.get("FLW_WEBHOOK_SECRET_HASH") || "").trim();
  if (!expected) return false;
  const provided = String(
    headers.get("verif-hash")
      || headers.get("x-verif-hash")
      || headers.get("x-flutterwave-signature")
      || "",
  ).trim();
  return Boolean(provided) && provided === expected;
}
