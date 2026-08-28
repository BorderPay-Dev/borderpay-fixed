export type YellowCardJitState =
  | "PENDING_SWEEP"
  | "SEND_INTENT_CREATED"
  | "TREASURY_SWEEP_SENT"
  | "YELLOW_CARD_CREDITED"
  | "DISPATCHED_TO_RAILS"
  | "REFUND_PENDING"
  | "COMPLETED"
  | "FAILED";

export function yellowCardJitWebhookTarget(input: {
  event: string;
  status: string;
  currentState: YellowCardJitState;
}): YellowCardJitState | null {
  const event = String(input.event || "").trim().toUpperCase();
  const status = String(input.status || "").trim().toLowerCase();
  if (["COMPLETED", "FAILED", "REFUND_PENDING"].includes(input.currentState)) return null;

  const failed = ["failed", "expired", "cancelled", "canceled", "settlement_failed", "refund_failed"].includes(status);
  if (failed && event.startsWith("SEND.") && [
    "TREASURY_SWEEP_SENT", "YELLOW_CARD_CREDITED", "DISPATCHED_TO_RAILS",
  ].includes(input.currentState)) return "REFUND_PENDING";
  if (failed && event.startsWith("CRYPTO_RECEIVE.")) return "FAILED";

  if (event === "CRYPTO_RECEIVE.COMPLETE" || status === "settlement_complete") {
    return input.currentState === "TREASURY_SWEEP_SENT" ? "YELLOW_CARD_CREDITED" : null;
  }
  if (event.startsWith("SEND.") && status === "complete") {
    return ["TREASURY_SWEEP_SENT", "YELLOW_CARD_CREDITED", "DISPATCHED_TO_RAILS"].includes(input.currentState)
      ? "COMPLETED"
      : null;
  }
  if (event.startsWith("SEND.") && ["process", "processing", "pending_liquidity"].includes(status)) {
    return input.currentState === "YELLOW_CARD_CREDITED" ? "DISPATCHED_TO_RAILS" : null;
  }
  return null;
}
