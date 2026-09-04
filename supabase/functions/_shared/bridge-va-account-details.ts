type JsonRecord = Record<string, unknown>;

const ACCOUNT_HOLDER_NAME_FIELDS = [
  "bank_beneficiary_name",
  "beneficiary_name",
  "account_holder_name",
  "account_name",
  "account_owner_name",
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function hasProviderValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

function mergeProviderRecord(existing: JsonRecord, incoming: JsonRecord): JsonRecord {
  const merged: JsonRecord = { ...existing };
  for (const [key, incomingValue] of Object.entries(incoming)) {
    if (!hasProviderValue(incomingValue)) continue;
    const existingRecord = asRecord(existing[key]);
    const incomingRecord = asRecord(incomingValue);
    merged[key] = existingRecord && incomingRecord
      ? mergeProviderRecord(existingRecord, incomingRecord)
      : incomingValue;
  }
  return merged;
}

/**
 * Bridge can roll out named EUR accounts one virtual account at a time and its
 * update webhook may contain only the changed beneficiary/account-holder name.
 * Merge that provider-owned update without deleting the existing IBAN, routing
 * number, account number, bank address, or payment-rail instructions.
 */
export function mergeBridgeSourceDepositInstructions(
  existingAccountDetails: unknown,
  bridgeVirtualAccount: unknown,
): JsonRecord | null {
  const existingDetails = asRecord(existingAccountDetails) ?? {};
  const payload = asRecord(bridgeVirtualAccount) ?? {};
  const payloadAccountDetails = asRecord(payload.account_details) ?? {};
  const payloadVirtualAccount = asRecord(payload.virtual_account) ?? {};

  const existingInstructions = asRecord(existingDetails.source_deposit_instructions) ?? {};
  const incomingInstructions =
    asRecord(payload.source_deposit_instructions) ??
    asRecord(payloadAccountDetails.source_deposit_instructions) ??
    asRecord(payloadVirtualAccount.source_deposit_instructions) ??
    {};

  const directNameUpdate: JsonRecord = {};
  for (const key of ACCOUNT_HOLDER_NAME_FIELDS) {
    const candidate = payload[key] ?? payloadAccountDetails[key] ?? payloadVirtualAccount[key];
    if (hasProviderValue(candidate)) directNameUpdate[key] = candidate;
  }

  const merged = mergeProviderRecord(
    existingInstructions,
    mergeProviderRecord(incomingInstructions, directNameUpdate),
  );

  return Object.keys(merged).length > 0 ? merged : null;
}
