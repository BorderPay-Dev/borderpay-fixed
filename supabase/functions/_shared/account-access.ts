const RESTRICTED_ACCOUNT_STATUSES = new Set([
  "frozen",
  "paused",
  "risk_paused",
  "restricted",
  "blocked",
  "suspended",
  "offboarded",
  "closed",
  "terminated",
  "deactivated",
  "rejected",
]);

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isRestrictedAccountStatus(value: unknown): boolean {
  return RESTRICTED_ACCOUNT_STATUSES.has(normalizeStatus(value));
}

export async function requireActiveAccount(
  supabase: any,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("account_status, bridge_account_status")
    .eq("id", userId)
    .maybeSingle();

  // Money movement must fail closed when compliance state cannot be read.
  if (error || !data) {
    return {
      ok: false,
      status: 503,
      body: {
        success: false,
        code: "account_access_unavailable",
        error: "We could not verify your account access. Please try again later.",
      },
    };
  }

  if (isRestrictedAccountStatus(data.account_status) || isRestrictedAccountStatus(data.bridge_account_status)) {
    return {
      ok: false,
      status: 403,
      body: {
        success: false,
        code: "account_frozen",
        error: "Your account is frozen. Contact support if you believe this is an error.",
      },
    };
  }

  return { ok: true };
}
