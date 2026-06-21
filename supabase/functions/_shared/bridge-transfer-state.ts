/**
 * Canonical Bridge transfer-state mapper.
 *
 * Purpose:
 * - Preserve provider truth (`provider_state`) exactly for reconciliation.
 * - Map to BorderPay's internal transaction_status for existing readers.
 * - Keep unknown/new provider states idempotent and non-destructive.
 */

export type BorderPayTransactionStatus = "pending" | "completed" | "failed";

export interface BridgeTransferStateMapping {
  providerState: string;
  recognized: boolean;
  terminal: boolean;
  transactionStatus: BorderPayTransactionStatus;
}

// Bridge transfer states documented in current integration references.
const BRIDGE_PENDING_STATES = new Set([
  "awaiting_funds",
  "in_review",
  "funds_received",
  "payment_submitted",
  "refund_in_flight",
]);

const BRIDGE_COMPLETED_STATES = new Set([
  "payment_processed",
]);

const BRIDGE_FAILED_STATES = new Set([
  "undeliverable",
  "returned",
  "missing_return_policy",
  "refunded",
  "refund_failed",
  "canceled",
  "error",
]);

function normalize(rawState: unknown): string {
  const s = String(rawState ?? "").trim().toLowerCase();
  return s || "unknown";
}

export function mapBridgeTransferState(rawState: unknown): BridgeTransferStateMapping {
  const providerState = normalize(rawState);

  if (BRIDGE_PENDING_STATES.has(providerState)) {
    return { providerState, recognized: true, terminal: false, transactionStatus: "pending" };
  }
  if (BRIDGE_COMPLETED_STATES.has(providerState)) {
    return { providerState, recognized: true, terminal: true, transactionStatus: "completed" };
  }
  if (BRIDGE_FAILED_STATES.has(providerState)) {
    return { providerState, recognized: true, terminal: true, transactionStatus: "failed" };
  }

  // Unknown provider state: preserve raw state but do not progress internal
  // money state optimistically.
  return { providerState, recognized: false, terminal: false, transactionStatus: "pending" };
}
