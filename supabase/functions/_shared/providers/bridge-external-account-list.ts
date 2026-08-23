/** Normalize Bridge list pagination into a stable, masked client contract. */
export function extractBridgeExternalAccounts(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  if (Array.isArray(payload.external_accounts)) return payload.external_accounts.filter(isRecord);
  if (Array.isArray(payload.data)) return payload.data.filter(isRecord);
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.external_accounts)) return payload.data.external_accounts.filter(isRecord);
    if (Array.isArray(payload.data.data)) return payload.data.data.filter(isRecord);
  }
  return [];
}

export function normalizeBridgeExternalAccounts(payload: unknown): Record<string, unknown>[] {
  return extractBridgeExternalAccounts(payload).map((row) => {
    const id = String(row.id || row.external_account_id || "").trim();
    const currency = String(row.currency || "").toUpperCase();
    const rawType = String(row.account_type || row.type || "").toLowerCase();
    const accountType = rawType === "gb" || currency === "GBP"
      ? "gb"
      : rawType === "iban" || currency === "EUR"
        ? "iban"
        : rawType === "us" || currency === "USD"
          ? "us"
          : "";
    const account = isRecord(row.account) ? row.account : {};
    const iban = isRecord(row.iban) ? row.iban : {};
    const lastFour = row.last_4 || account.last_4 || iban.last_4 || null;
    return {
      id,
      bridge_external_account_id: id,
      account_type: accountType,
      currency: currency || (accountType === "gb" ? "GBP" : accountType === "iban" ? "EUR" : accountType === "us" ? "USD" : ""),
      account_owner_name: typeof row.account_owner_name === "string" ? row.account_owner_name : null,
      bank_name: typeof row.bank_name === "string" ? row.bank_name : null,
      last_4: lastFour == null ? null : String(lastFour),
      rail: typeof row.rail === "string"
        ? row.rail
        : accountType === "gb" ? "faster_payments" : accountType === "iban" ? "sepa" : "ach",
      status: typeof row.status === "string" ? row.status : "active",
    };
  }).filter((row) => Boolean(row.bridge_external_account_id && row.account_type && row.currency));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
