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
  static_ip_required: boolean;
  static_ip_ready: boolean;
}

const FLW_LOCAL_COUNTRIES = ["NG", "KE", "GH", "UG", "TZ", "RW", "ZM", "ZA"] as const;
const FLW_LOCAL_CURRENCIES = ["NGN", "KES", "GHS", "UGX", "TZS", "RWF", "ZMW", "ZAR"] as const;

function envEnabled(name: string): boolean {
  return (Deno.env.get(name) || "").toLowerCase() === "true";
}

function envDefaultTrue(name: string): boolean {
  const raw = String(Deno.env.get(name) || "").trim().toLowerCase();
  if (!raw) return true;
  return raw === "true";
}

export function getFlutterwaveCapabilities(): FlutterwaveCapabilities {
  return {
    configured: flutterwaveClientConfigured(),
    receive_enabled: envEnabled("FLW_RECEIVE_ENABLED"),
    payout_enabled: envEnabled("FLW_PAYOUT_ENABLED"),
    base_url: (Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com").replace(/\/+$/, ""),
    static_ip_required: envDefaultTrue("FLW_STATIC_IP_REQUIRED"),
    static_ip_ready: envEnabled("FLW_STATIC_IP_READY"),
  };
}

export function getFlutterwaveNetworkGuard(scope: "money_movement" | "read"): {
  allowed: boolean;
  code: "ok" | "static_ip_not_ready";
  message: string;
  static_ip_required: boolean;
  static_ip_ready: boolean;
} {
  const caps = getFlutterwaveCapabilities();
  if (scope === "read") {
    return {
      allowed: true,
      code: "ok",
      message: "Read scope allowed.",
      static_ip_required: caps.static_ip_required,
      static_ip_ready: caps.static_ip_ready,
    };
  }

  if (caps.static_ip_required && !caps.static_ip_ready) {
    return {
      allowed: false,
      code: "static_ip_not_ready",
      message: "Flutterwave money movement is blocked until static egress IP is allowlisted and marked ready.",
      static_ip_required: caps.static_ip_required,
      static_ip_ready: caps.static_ip_ready,
    };
  }

  return {
    allowed: true,
    code: "ok",
    message: "Money movement allowed.",
    static_ip_required: caps.static_ip_required,
    static_ip_ready: caps.static_ip_ready,
  };
}

export function getFlutterwaveLocalRailPolicy() {
  return {
    countries: [...FLW_LOCAL_COUNTRIES],
    currencies: [...FLW_LOCAL_CURRENCIES],
    methods: ["bank", "mobile_money"] as const,
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

export async function flutterwaveResolveBankAccount(input: {
  account_number: string;
  bank_code: string;
}) {
  return flutterwaveFetch({
    method: "POST",
    path: "/v3/accounts/resolve",
    body: {
      account_number: input.account_number,
      bank_code: input.bank_code,
    },
    idempotencyKey: `borderpay:flw:resolve:${input.bank_code}:${input.account_number}`,
  });
}

export async function flutterwaveCreateTransfer(input: {
  amount: number | string;
  currency: string;
  account_bank: string;
  account_number: string;
  narration?: string;
  reference: string;
  callback_url?: string;
  debit_currency?: string;
  beneficiary_name?: string;
  meta?: Record<string, unknown>;
}) {
  return flutterwaveFetch({
    method: "POST",
    path: "/v3/transfers",
    body: input,
    idempotencyKey: input.reference,
  });
}

export async function flutterwaveGetTransfer(transferId: string) {
  return flutterwaveFetch({
    method: "GET",
    path: `/v3/transfers/${encodeURIComponent(transferId)}`,
  });
}

export async function flutterwaveRetryTransfer(transferId: string, body?: Record<string, unknown>) {
  const template = Deno.env.get("FLW_TRANSFER_RETRY_PATH_TEMPLATE") || "/v3/transfers/{id}/retries";
  const path = template.replace("{id}", encodeURIComponent(transferId));
  return flutterwaveFetch({
    method: "POST",
    path,
    body: body || {},
    idempotencyKey: `borderpay:flw:retry:${transferId}`,
  });
}

export async function verifyFlutterwaveWebhookSignature(headers: Headers): Promise<boolean> {
  // Flutterwave commonly sends `verif-hash`; keep this in env and compare.
  const expected = String(
    Deno.env.get("FLW_WEBHOOK_SECRET_HASH")
      || Deno.env.get("FLW_WEBHOOK_SECRET")
      || "",
  ).trim();
  if (!expected) return false;
  const provided = String(
    headers.get("verif-hash")
      || headers.get("Verif-Hash")
      || headers.get("x-verif-hash")
      || headers.get("x-flutterwave-signature")
      || headers.get("X-Flutterwave-Signature")
      || "",
  ).trim();
  if (!provided) return false;
  // Constant-time compare to avoid timing leakage.
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
