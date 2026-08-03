/**
 * Flutterwave adapter (backend scaffolding only).
 *
 * Purpose:
 * - Provide a typed internal interface for local rails (bank/mobile money)
 * - Keep all provider HTTP details inside shared adapter code
 * - No UI coupling and no production routing switch in this file
 */

import { flutterwaveFetch } from "./flutterwave-client.ts";
import { flutterwaveV4BaseUrl, flutterwaveV4Configured } from "./flutterwave-v4-client.ts";
import {
  createKenyaRecipient,
  createKenyaTransfer,
  getKenyaTransfer,
  getUsdWalletBalance,
  listKenyaBanks,
  listKenyaMobileNetworks,
  quoteKenyaDestinationAmount,
  retryKenyaTransfer,
} from "./flutterwave-v4-payout.ts";

export interface FlutterwaveCapabilities {
  configured: boolean;
  receive_enabled: boolean;
  payout_enabled: boolean;
  base_url: string;
  static_ip_required: boolean;
  static_ip_ready: boolean;
}

export type FlutterwaveMovementState =
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "reversed"
  | "unknown";

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
    configured: flutterwaveV4Configured(),
    // V4 collection bodies are outside this Kenya-send-only patch. Keep inflow
    // fail-closed even if a stale environment flag exists.
    receive_enabled: false,
    payout_enabled: envEnabled("FLW_PAYOUT_ENABLED"),
    base_url: flutterwaveV4BaseUrl(),
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
    countries: ["KE"],
    currencies: ["KES"],
    methods: ["bank", "mobile_money"] as const,
  };
}

export async function flutterwaveHealthCheck() {
  return getUsdWalletBalance();
}

export async function flutterwaveListPaymentMethods(country?: string) {
  if (country && country.toUpperCase() !== "KE") {
    return { ok: false, status: 400, data: null, error: "flutterwave_kenya_send_only", traceId: "local-policy" };
  }
  return {
    ok: true,
    status: 200,
    data: { country: "KE", currency: "KES", methods: ["bank", "mobile_money"], source: "flutterwave_v4_recipient_types" },
    traceId: "local-policy",
  };
}

export async function flutterwaveListBanks(country: string) {
  if (country.toUpperCase() !== "KE") return { ok: false, status: 400, data: null, error: "flutterwave_kenya_send_only", traceId: "local-policy" };
  return listKenyaBanks();
}

export async function flutterwaveListMobileNetworks(country: string) {
  if (country.toUpperCase() !== "KE") return { ok: false, status: 400, data: null, error: "flutterwave_kenya_send_only", traceId: "local-policy" };
  return listKenyaMobileNetworks();
}

export async function flutterwaveGetTransferRates(input: {
  source_currency: string;
  destination_currency: string;
  destination_amount: number;
  reference: string;
}) {
  if (input.destination_currency.toUpperCase() !== "KES") {
    return { ok: false, status: 400, data: null, error: "flutterwave_kenya_send_only", traceId: "local-policy" };
  }
  return quoteKenyaDestinationAmount({
    sourceCurrency: input.source_currency.toUpperCase(),
    destinationAmount: input.destination_amount,
    reference: input.reference,
  });
}

export async function flutterwaveResolveBankAccount(input: {
  account_number: string;
  bank_code: string;
}) {
  void input;
  // Flutterwave V4's documented bank account lookup supports NGN, GBP and USD,
  // not KES. Kenya validation occurs through recipient creation.
  return { ok: false, status: 422, data: null, error: "flutterwave_v4_kes_account_lookup_not_supported", traceId: "local-policy" };
}

export async function flutterwaveCreateTransfer(input: {
  amount: number;
  applies_to: "source_currency" | "destination_currency";
  source_currency: string;
  channel: "bank" | "mobile_money";
  account_bank?: string;
  account_number: string;
  recipient_first_name: string;
  recipient_last_name: string;
  narration?: string;
  reference: string;
  callback_url?: string;
  sender_id?: string;
  meta?: Record<string, unknown>;
}) {
  const recipient = await createKenyaRecipient({
    channel: input.channel,
    firstName: input.recipient_first_name,
    lastName: input.recipient_last_name,
    accountNumber: input.account_number,
    bankCode: input.channel === "bank" ? input.account_bank : undefined,
    network: input.channel === "mobile_money" ? input.account_bank : undefined,
    reference: input.reference,
  });
  if (!recipient.ok) return { ...recipient, stage: "recipient" as const };
  const recipientData: any = (recipient.data as any)?.data ?? recipient.data;
  const recipientId = String(recipientData?.id || "").trim();
  if (!recipientId) {
    return { ok: false, status: 502, data: recipient.data, error: "flutterwave_recipient_id_missing", traceId: recipient.traceId, stage: "recipient" as const };
  }
  const transfer = await createKenyaTransfer({
    recipientId,
    sourceCurrency: input.source_currency,
    amount: input.amount,
    appliesTo: input.applies_to,
    reference: input.reference,
    narration: input.narration,
    callbackUrl: input.callback_url,
    senderId: input.sender_id,
    meta: input.meta,
  });
  return {
    ...transfer,
    data: { recipient: recipient.data, transfer: transfer.data },
    recipientId,
    recipientTraceId: recipient.traceId,
    transferTraceId: transfer.traceId,
    stage: transfer.ok ? "transfer" as const : "transfer" as const,
  };
}

export async function flutterwaveGetTransfer(transferId: string) {
  return getKenyaTransfer(transferId);
}

export async function flutterwaveRetryTransfer(transferId: string, body?: Record<string, unknown>) {
  const reference = String(body?.reference || "").trim();
  if (!reference) return { ok: false, status: 400, data: null, error: "flutterwave_retry_reference_required", traceId: "local-validation" };
  return retryKenyaTransfer(transferId, reference, typeof body?.meta === "object" ? body.meta as Record<string, unknown> : undefined);
}

export async function flutterwaveCreateCharge(input: {
  amount: number | string;
  currency: string;
  country: string;
  tx_ref: string;
  email?: string;
  fullname?: string;
  payment_type?: "bank_transfer" | "mobilemoney";
  meta?: Record<string, unknown>;
}) {
  return flutterwaveFetch({
    method: "POST",
    path: "/v3/charges",
    body: input,
    idempotencyKey: input.tx_ref,
  });
}

export async function flutterwaveGetCharge(chargeId: string) {
  return flutterwaveFetch({
    method: "GET",
    path: `/v3/charges/${encodeURIComponent(chargeId)}`,
  });
}

export function mapFlutterwaveProviderStatus(raw: unknown): FlutterwaveMovementState {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (["successful", "success", "completed", "complete", "paid"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled", "declined"].includes(s)) return "failed";
  if (["reversed", "refunded"].includes(s)) return "reversed";
  if (["pending", "processing", "queued", "new", "initiated"].includes(s)) return "processing";
  return "unknown";
}

export async function verifyFlutterwaveWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
  // V4 signs the exact raw body with HMAC-SHA256 and base64-encodes the digest.
  // Source: https://developer.flutterwave.com/docs/webhooks
  const expected = String(
    Deno.env.get("FLW_WEBHOOK_SECRET_HASH")
      || Deno.env.get("FLW_WEBHOOK_SECRET")
      || "",
  ).trim();
  if (!expected) return false;
  const provided = String(
    headers.get("flutterwave-signature")
      || headers.get("Flutterwave-Signature")
      || headers.get("x-flutterwave-signature")
      || headers.get("X-Flutterwave-Signature")
      || "",
  ).trim();
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(expected),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const calculated = btoa(binary);
  // Constant-time compare to avoid timing leakage.
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(calculated);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
