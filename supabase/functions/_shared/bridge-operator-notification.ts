const OPERATOR_ACTIONABLE_STATES = new Set([
  "approved",
  "completed",
  "complete",
  "payment_processed",
  "processed",
  "succeeded",
  "success",
  "failed",
  "payment_failed",
  "canceled",
  "cancelled",
  "cancelled_by_customer",
  "canceled_by_customer",
  "in_review",
  "under_review",
  "review",
  "pending_review",
  "manual_review",
  "refund_in_flight",
  "refund_pending",
  "return_in_flight",
  "refunded",
  "returned",
  "refund_complete",
  "refund_completed"
]);
function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function firstText(...values) {
  for (const value of values){
    const text = String(value ?? "").trim().toLowerCase();
    if (text) return text;
  }
  return null;
}
export function bridgeOperatorEventState(payload) {
  const eventObject = objectValue(payload.event_object) ?? objectValue(payload.data) ?? payload;
  const receipt = objectValue(eventObject.receipt);
  return firstText(eventObject.state, eventObject.status, eventObject.type, payload.event_object_status, receipt?.status);
}
/**
 * Raw Bridge events remain immutable evidence, but only terminal financial
 * outcomes and compliance-actionable states may trigger operator email.
 * Pre-settlement signals such as funds_scheduled, funds_received and
 * payment_submitted are deliberately excluded.
 */ export function shouldNotifyBridgeOperator(input) {
  const eventType = String(input.eventType || "").trim().toLowerCase();
  const isFinancialResource = eventType.includes("transfer") || eventType.includes("liquidation") || eventType.includes("virtual_account") && (eventType.includes("activity") || eventType.includes("deposit") || eventType.includes("credit") || eventType.includes("refund"));
  if (!isFinancialResource) return false;
  const state = bridgeOperatorEventState(input.payload);
  return state !== null && OPERATOR_ACTIONABLE_STATES.has(state);
}
