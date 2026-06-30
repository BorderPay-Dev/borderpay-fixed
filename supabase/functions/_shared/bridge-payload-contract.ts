import { type BridgeRouteBucket } from "./bridge-ingress-evaluator.ts";

export interface BridgePayloadContractResult {
  valid: boolean;
  reason_code: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function eventObject(payload: Record<string, unknown>): Record<string, unknown> {
  const eo = payload.event_object;
  if (eo && typeof eo === "object" && !Array.isArray(eo)) {
    return eo as Record<string, unknown>;
  }
  const d = payload.data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return d as Record<string, unknown>;
  }
  return payload;
}

function firstNonEmptyString(...vals: unknown[]): string {
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

export function validateBridgePayloadContract(
  routeBucket: BridgeRouteBucket,
  payloadRaw: unknown,
): BridgePayloadContractResult {
  const payload = asRecord(payloadRaw);
  const obj = eventObject(payload);

  const customerId = firstNonEmptyString(
    obj.customer_id,
    (obj.customer as Record<string, unknown> | undefined)?.id,
    payload.event_object_id,
    obj.id,
  );
  const transferId = firstNonEmptyString(obj.transfer_id, payload.event_object_id, obj.id);
  const virtualAccountId = firstNonEmptyString(obj.virtual_account_id, payload.event_object_id, obj.id);
  const walletId = firstNonEmptyString(obj.wallet_id, payload.event_object_id, obj.id);
  const externalAccountId = firstNonEmptyString(obj.external_account_id, payload.event_object_id, obj.id);

  switch (routeBucket) {
    case "bridge.kyc":
      return customerId
        ? { valid: true, reason_code: "payload_contract_ok" }
        : { valid: false, reason_code: "invalid_payload_contract_missing_customer_id" };
    case "bridge.virtual_account":
      return virtualAccountId
        ? { valid: true, reason_code: "payload_contract_ok" }
        : { valid: false, reason_code: "invalid_payload_contract_missing_virtual_account_id" };
    case "bridge.wallet":
      return walletId
        ? { valid: true, reason_code: "payload_contract_ok" }
        : { valid: false, reason_code: "invalid_payload_contract_missing_wallet_id" };
    case "bridge.external_account":
      return externalAccountId
        ? { valid: true, reason_code: "payload_contract_ok" }
        : { valid: false, reason_code: "invalid_payload_contract_missing_external_account_id" };
    case "bridge.transfer":
      return transferId
        ? { valid: true, reason_code: "payload_contract_ok" }
        : { valid: false, reason_code: "invalid_payload_contract_missing_transfer_id" };
    case "bridge.customer":
      return customerId
        ? { valid: true, reason_code: "payload_contract_ok" }
        : { valid: false, reason_code: "invalid_payload_contract_missing_customer_id" };
    case "bridge.unknown":
    default:
      return { valid: true, reason_code: "payload_contract_unknown_bucket" };
  }
}

