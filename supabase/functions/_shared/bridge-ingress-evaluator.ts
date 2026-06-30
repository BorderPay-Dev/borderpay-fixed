export type IngressDecision = "accept" | "reject" | "duplicate" | "retryable_fail";
export type IngressRoutingTarget = "queue" | "drop" | "log_only";
export const BRIDGE_INGRESS_DECISION_SOURCE = "bridge_ingress_evaluator_v1" as const;
export type BridgeRouteBucket =
  | "bridge.kyc"
  | "bridge.virtual_account"
  | "bridge.wallet"
  | "bridge.external_account"
  | "bridge.transfer"
  | "bridge.customer"
  | "bridge.unknown";

export interface BridgeIngressEvaluationInput {
  source: "bridge" | "bridge_test";
  eventIdRaw: string | null | undefined;
  eventTypeRaw: string | null | undefined;
  payload: unknown;
  signatureOk: boolean;
  replayWindowOk: boolean;
  parseOk: boolean;
  knownDuplicate?: boolean;
}

export interface BridgeIngressDecision {
  _decision_source: typeof BRIDGE_INGRESS_DECISION_SOURCE;
  decision: IngressDecision;
  reason_code: string;
  derived_event_type: string;
  normalized_payload: Record<string, unknown>;
  idempotency_key: string;
  routing_target: IngressRoutingTarget;
  route_bucket: BridgeRouteBucket;
}

function normalizeEventType(value: string | null | undefined): string {
  const v = String(value ?? "").trim().toLowerCase();
  return v || "unknown";
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function deriveEventId(
  explicitId: string | null | undefined,
  payload: Record<string, unknown>,
): string {
  const fromPayload = String(
    payload.id
      ?? payload.event_id
      ?? (payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>).id : "")
      ?? "",
  ).trim();
  const raw = String(explicitId ?? fromPayload).trim();
  return raw || "unknown_event";
}

function routeBucketForEventType(eventType: string): BridgeRouteBucket {
  const t = eventType.toLowerCase();
  if (t.startsWith("kyc_link.") || t.startsWith("kyb_link.") || t.startsWith("customer.kyc") || t.startsWith("customer.kyb")) return "bridge.kyc";
  if (t.startsWith("virtual_account.")) return "bridge.virtual_account";
  if (t.startsWith("wallet.") || t.startsWith("bridge_wallet.")) return "bridge.wallet";
  if (t.startsWith("external_account.")) return "bridge.external_account";
  if (t.startsWith("transfer.") || t.startsWith("payout.") || t.startsWith("deposit.")) return "bridge.transfer";
  if (t.startsWith("customer.")) return "bridge.customer";
  return "bridge.unknown";
}

export function assertBridgeIngressDecision(decision: BridgeIngressDecision): void {
  if (decision?._decision_source !== BRIDGE_INGRESS_DECISION_SOURCE) {
    throw new Error("bridge_ingress_decision_boundary_violation");
  }
}

export function evaluateBridgeIngressEvent(input: BridgeIngressEvaluationInput): BridgeIngressDecision {
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
      route_bucket: routeBucket,
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
      route_bucket: routeBucket,
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
      route_bucket: routeBucket,
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
      route_bucket: routeBucket,
    };
  }
  const contract = validateBridgePayloadContract(routeBucket, normalizedPayload);
  if (!contract.valid) {
    return {
      _decision_source: BRIDGE_INGRESS_DECISION_SOURCE,
      decision: "reject",
      reason_code: contract.reason_code,
      derived_event_type: eventType,
      normalized_payload: normalizedPayload,
      idempotency_key: idempotencyKey,
      routing_target: "drop",
      route_bucket: routeBucket,
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
      route_bucket: routeBucket,
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
    route_bucket: routeBucket,
  };
}
import { validateBridgePayloadContract } from "./bridge-payload-contract.ts";
