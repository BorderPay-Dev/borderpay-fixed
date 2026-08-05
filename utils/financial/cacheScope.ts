export type FinancialAccountType = "individual" | "business";

export interface FinancialCacheScope {
  userId: string;
  accountType: FinancialAccountType;
}

function normalizeAccountType(value: unknown): FinancialAccountType {
  return String(value || "").toLowerCase() === "business" ? "business" : "individual";
}

export function resolveFinancialCacheScope(explicitUserId?: string | null): FinancialCacheScope {
  const fallbackUserId = String(explicitUserId || "").trim();
  try {
    const raw = localStorage.getItem("borderpay_user");
    const parsed = raw ? JSON.parse(raw) : {};
    const cachedUserId = String(parsed?.id || "").trim();
    return {
      // Explicit userId comes from the active auth/session route and must win.
      // Letting a stale cached profile override it creates a cold-cache miss on
      // sign-in and can briefly paint a zero-balance "new account" state.
      userId: fallbackUserId || cachedUserId || "anon",
      accountType: normalizeAccountType(parsed?.account_type),
    };
  } catch {
    return {
      userId: fallbackUserId || "anon",
      accountType: "individual",
    };
  }
}

export function financialCacheKey(
  base: string,
  scope: { userId?: string | null; accountType?: FinancialAccountType } = {},
): string {
  const resolved = resolveFinancialCacheScope(scope.userId);
  // One financial engine: cache scope is user-level, not account-type-level.
  // Splitting by account type causes avoidable cache misses and slower route
  // paints for business users even when the underlying snapshot data is shared.
  return `${base}:financial-v2:${resolved.userId}`;
}
