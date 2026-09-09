import { validateBridgePayloadContract } from "./bridge-payload-contract.ts";
export const BRIDGE_INGRESS_DECISION_SOURCE = "bridge_ingress_evaluator_v1";
function normalizeEventType(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v || "unknown";
}
function normalizePayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload;
  }
  return {};
}
function deriveEventId(explicitId, payload) {
  const fromPayload = String(payload.id ?? payload.event_id ?? (payload.data && typeof payload.data === "object" ? payload.data.id : "") ?? "").trim();
  const raw = String(explicitId ?? fromPayload).trim();
  return raw || "unknown_event";
}
function routeBucketForEventType(eventType) {
  const t = eventType.toLowerCase();
  if (t.startsWith("kyc_link.") || t.startsWith("kyb_link.") || t.startsWith("customer.kyc") || t.startsWith("customer.kyb")) return "bridge.kyc";
  if (t.startsWith("virtual_account.")) return "bridge.virtual_account";
  if (t.startsWith("wallet.") || t.startsWith("bridge_wallet.")) return "bridge.wallet";
  if (t.startsWith("external_account.")) return "bridge.external_account";
  if (t.startsWith("liquidation_address.") || t.includes("liquidation_address.drain") || t.includes("drain.")) return "bridge.liquidation_address";
  if (t.startsWith("transfer.") || t.startsWith("payout.") || t.startsWith("deposit.")) return "bridge.transfer";
  if (t.startsWith("customer.")) return "bridge.customer";
  return "bridge.unknown";
}
export function assertBridgeIngressDecision(decision) {
  if (decision?._decision_source !== BRIDGE_INGRESS_DECISION_SOURCE) {
    throw new Error("bridge_ingress_decision_boundary_violation");
  }
}
export function evaluateBridgeIngressEvent(input) {
  const normalizedPayload = normalizePayload(input.payload);
  const eventType = normalizeEventType(input.eventTypeRaw);
  const eventId = deriveEventId(input.eventIdRaw, normalizedPayload);
  const idempotencyKey = `${input.source}:${eventId}`;
  const routeBucket = routeBucketForEventType(eventType);
  if (!input.signatureOk) {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "reject",
      reason_code: "signature_verify_failed",
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "drop",
      route_bucket: routeBucket
    };
  }
  if (!input.replayWindowOk) {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "reject",
      reason_code: "replay_window_exceeded",
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "drop",
      route_bucket: routeBucket
    };
  }
  if (!input.parseOk) {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "reject",
      reason_code: "invalid_json",
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "drop",
      route_bucket: routeBucket
    };
  }
  if (routeBucket === "bridge.unknown") {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "accept",
      reason_code: "unknown_event_type_log_only",
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "log_only",
      route_bucket: routeBucket
    };
  }
  const contract = input.source === "bridge" ? validateBridgePayloadContract(routeBucket, eventType, normalizedPayload) : {
    valid: true,
    reason_code: "payload_contract_skipped_for_bridge_test"
  };
  if (!contract.valid) {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "reject",
      reason_code: contract.reason_code,
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "drop",
      route_bucket: routeBucket
    };
  }
  if (contract.routing_target === "log_only") {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "accept",
      reason_code: contract.reason_code,
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "log_only",
      route_bucket: routeBucket
    };
  }
  if (input.knownDuplicate) {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "duplicate",
      reason_code: "duplicate_event",
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "log_only",
      route_bucket: routeBucket
    };
  }
  return {
    _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
    decision: "accept",
    reason_code: "accepted_new_event",
    derived_event_type: eventType,
    normalized_payload: normalizedPayload,
    idempotency_key: idempotencyKey,
    routing_target: "queue",
    route_bucket: routeBucket
  };
}
