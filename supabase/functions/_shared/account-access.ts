type SupabaseLike = {
  from: (table: string) => any;
};

const FINANCIAL_LOCKED_STATUSES = new Set([
  "frozen",
  "paused",
  "risk_paused",
  "restricted",
  "suspended",
  "blocked",
  "deactivated",
  "closed",
  "offboarded",
  "terminated",
  "rejected",
]);

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type FinancialAccessBlock = {
  code: "account_frozen";
  error: string;
  account_status: string;
  frozen_at: string | null;
};

/**
 * Server-side financial access lock. Every customer-triggered money or account
 * provisioning endpoint must call this after authentication and before any
 * provider or ledger side effect. Query failures fail closed.
 */
export async function getFinancialAccessBlock(
  supabase: SupabaseLike,
  userId: string,
): Promise<FinancialAccessBlock | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("account_status,account_frozen_at,bridge_account_status,bridge_account_paused_at")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      code: "account_frozen",
      error: "Account access could not be verified. Financial actions are temporarily unavailable.",
      account_status: "access_check_failed",
      frozen_at: null,
    };
  }

  const localStatus = normalizeStatus(data.account_status);
  const bridgeStatus = normalizeStatus(data.bridge_account_status);
  const status = FINANCIAL_LOCKED_STATUSES.has(localStatus)
    ? localStatus
    : bridgeStatus;
  if (!FINANCIAL_LOCKED_STATUSES.has(status)) return null;
  return {
    code: "account_frozen",
    error: "This account is frozen. Financial actions are unavailable. Contact BorderPay support.",
    account_status: status,
    frozen_at: data.account_frozen_at
      ? String(data.account_frozen_at)
      : data.bridge_account_paused_at
        ? String(data.bridge_account_paused_at)
        : null,
  };
}
