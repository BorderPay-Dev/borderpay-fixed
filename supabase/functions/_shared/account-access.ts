type SupabaseLike = {
  from: (table: string) => any;
};

const FINANCIAL_LOCKED_STATUSES = new Set([
  "frozen",
  "paused",
  "suspended",
  "blocked",
  "deactivated",
  "closed",
  "offboarded",
  "terminated",
]);

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
    .select("account_status,account_frozen_at,bridge_account_status")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      code: "account_frozen",
      error: "Account access is temporarily unavailable. Please try again shortly.",
      account_status: "access_check_failed",
      frozen_at: null,
    };
  }

  const status = String(data?.account_status || "").trim().toLowerCase();
  const providerStatus = String(data?.bridge_account_status || '').trim().toLowerCase();
  if (!data.account_frozen_at && !FINANCIAL_LOCKED_STATUSES.has(status) && !FINANCIAL_LOCKED_STATUSES.has(providerStatus)) return null;
  return {
    code: "account_frozen",
    error: "This account is frozen. Financial actions are unavailable. Contact BorderPay support.",
    account_status: status || providerStatus,
    frozen_at: data?.account_frozen_at ? String(data.account_frozen_at) : null,
  };
}
