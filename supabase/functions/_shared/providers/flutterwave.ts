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

const FLW_LOCAL_COUNTRIES = ["NG", "KE", "GH", "UG", "TZ", "RW", "ZM", "ZA"] as const;
const FLW_LOCAL_CURRENCIES = ["NGN", "KES", "GHS", "UGX", "TZS", "RWF", "ZMW", "ZAR"] as const;

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

export async function flutterwaveCreateCollection(input: {
  amount: number | string;
  currency: string;
  tx_ref: string;
  customer?: Record<string, unknown>;
  payment_options?: string;
  redirect_url?: string;
  customizations?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) {
  const path = Deno.env.get("FLW_COLLECTION_CREATE_PATH") || "/v3/charges";
  return flutterwaveFetch({
    method: "POST",
    path,
    body: input,
    idempotencyKey: input.tx_ref,
  });
}

export async function flutterwaveGetCollection(collectionId: string) {
  const template = Deno.env.get("FLW_COLLECTION_STATUS_PATH_TEMPLATE") || "/v3/charges/{id}";
  const path = template.replace("{id}", encodeURIComponent(collectionId));
  return flutterwaveFetch({
    method: "GET",
    path,
  });
}

export async function flutterwaveListCollections(query?: {
  tx_ref?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const path = Deno.env.get("FLW_COLLECTION_LIST_PATH") || "/v3/charges";
  return flutterwaveFetch({
    method: "GET",
    path,
    query: {
      tx_ref: query?.tx_ref,
      status: query?.status,
      from: query?.from,
      to: query?.to,
      page: query?.page,
      limit: query?.limit,
    },
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
