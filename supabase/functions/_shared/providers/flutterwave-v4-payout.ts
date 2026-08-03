/** Flutterwave V4 Kenya payout adapter. No V3 request bodies are accepted here. */

import {
  flutterwaveV4Fetch,
  newFlutterwaveTraceId,
  type FlutterwaveV4Result,
} from "./flutterwave-v4-client.ts";

export type KenyaPayoutChannel = "bank" | "mobile_money";
export type TransferAmountAppliesTo = "source_currency" | "destination_currency";

export interface KenyaRecipientInput {
  channel: KenyaPayoutChannel;
  firstName: string;
  lastName: string;
  accountNumber: string;
  bankCode?: string;
  network?: string;
  reference: string;
}

export interface KenyaTransferInput {
  recipientId: string;
  sourceCurrency: string;
  amount: number;
  appliesTo: TransferAmountAppliesTo;
  reference: string;
  narration?: string;
  callbackUrl?: string;
  senderId?: string;
  meta?: Record<string, unknown>;
}

function key(scope: string, reference: string): string {
  return `borderpay:flw:v4:${scope}:${reference}`.slice(0, 255);
}

export function createKenyaRecipient(input: KenyaRecipientInput) {
  const mobileNumber = input.accountNumber.startsWith("+") ? input.accountNumber.slice(1) : input.accountNumber;
  const body = input.channel === "bank"
    ? {
      type: "bank_kes",
      name: { first: input.firstName, last: input.lastName },
      bank: { account_number: input.accountNumber, code: input.bankCode },
    }
    : {
      type: "mobile_money_kes",
      name: { first: input.firstName, last: input.lastName },
      mobile_money: { network: input.network, msisdn: mobileNumber },
    };
  return flutterwaveV4Fetch({
    method: "POST",
    path: "/transfers/recipients",
    body,
    traceId: newFlutterwaveTraceId("recipient"),
    idempotencyKey: key("recipient", input.reference),
  });
}

export function createKenyaTransfer(input: KenyaTransferInput) {
  return flutterwaveV4Fetch({
    method: "POST",
    path: "/transfers",
    body: {
      action: "instant",
      reference: input.reference,
      ...(input.narration ? { narration: input.narration.slice(0, 180) } : {}),
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
      payment_instruction: {
        recipient_id: input.recipientId,
        source_currency: input.sourceCurrency,
        amount: { value: input.amount, applies_to: input.appliesTo },
        ...(input.senderId ? { sender_id: input.senderId } : {}),
      },
    },
    traceId: newFlutterwaveTraceId("transfer"),
    idempotencyKey: key("transfer", input.reference),
  });
}

export function getKenyaTransfer(transferId: string) {
  return flutterwaveV4Fetch({ method: "GET", path: `/transfers/${encodeURIComponent(transferId)}`, traceId: newFlutterwaveTraceId("status") });
}

export function retryKenyaTransfer(transferId: string, reference: string, meta?: Record<string, unknown>) {
  return flutterwaveV4Fetch({
    method: "POST",
    path: `/transfers/${encodeURIComponent(transferId)}/retries`,
    body: { action: "retry", reference, ...(meta ? { meta } : {}) },
    traceId: newFlutterwaveTraceId("retry"),
    idempotencyKey: key("retry", reference),
  });
}

export function quoteKenyaDestinationAmount(input: { sourceCurrency: string; destinationAmount: number; reference: string }) {
  return flutterwaveV4Fetch({
    method: "POST",
    path: "/transfers/rates",
    body: {
      source: { currency: input.sourceCurrency },
      destination: { currency: "KES", amount: input.destinationAmount },
    },
    traceId: newFlutterwaveTraceId("rate"),
    idempotencyKey: key("rate", input.reference),
  });
}

export function listKenyaBanks() {
  return flutterwaveV4Fetch({ method: "GET", path: "/banks", query: { country: "KE" }, traceId: newFlutterwaveTraceId("banks") });
}

export function listKenyaMobileNetworks() {
  return flutterwaveV4Fetch({ method: "GET", path: "/mobile-networks", query: { country: "KE" }, traceId: newFlutterwaveTraceId("networks") });
}

export function getUsdWalletBalance(): Promise<FlutterwaveV4Result> {
  return flutterwaveV4Fetch({ method: "GET", path: "/wallets/balances/USD", traceId: newFlutterwaveTraceId("health") });
}

export function userSafeFlutterwavePayoutError(error?: string): string {
  switch (error) {
    case "flutterwave_amount_below_minimum": return "This amount is below the available payout limit.";
    case "flutterwave_amount_above_limit": return "This amount is above the available payout limit.";
    case "flutterwave_invalid_bank_code": return "Select a valid destination bank and try again.";
    case "flutterwave_recipient_rejected": return "We could not validate this recipient. Check the details and try again.";
    case "flutterwave_conflict": return "This payout request has already been submitted.";
    case "flutterwave_rate_limited": return "This payout service is temporarily busy. Please try again shortly.";
    default: return "This payout could not be processed. No funds were sent.";
  }
}
