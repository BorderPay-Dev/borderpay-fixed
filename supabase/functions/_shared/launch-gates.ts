/**
 * BorderPay launch gates.
 *
 * These gates intentionally fail closed. They protect billable/provider-touching
 * Bridge operations while signup and read-only app access continue.
 */

export const BRIDGE_ONBOARDING_PAUSED_CODE = "bridge_onboarding_paused";

function envEnabled(name: string): boolean {
  return (Deno.env.get(name) || "").trim().toLowerCase() === "true";
}

export function bridgeOnboardingEnabled(): boolean {
  return envEnabled("BRIDGE_ONBOARDING_ENABLED");
}

/**
 * KYC/KYB is always free.
 *
 * Payment gating is enforced on money-movement functions only
 * (bridge-transfer / bridge-wallet / bridge-external-account / bridge-virtual-account).
 * This helper is kept for compatibility with older imports and now always
 * returns false.
 */
export function kycRequiresPayment(): boolean {
  return false;
}

export function bridgeOnboardingPausedBody() {
  return {
    success: false,
    code: BRIDGE_ONBOARDING_PAUSED_CODE,
    error: "Verification is paused until BorderPay launches money movement. You can keep using your account.",
    summary: {
      code: BRIDGE_ONBOARDING_PAUSED_CODE,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification gate for KYC/KYB entry points.
//
// Rule: KYC/KYB is free and never payment-gated. The only hard gate here is
// the launch pause flag (BRIDGE_ONBOARDING_ENABLED).
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_REQUIRED_CODE       = "payment_required";

/** Deprecated: retained for compatibility with existing imports. */
export const PAID_PLAN_KEYS: ReadonlySet<string> = new Set([
  "individual_activated",
  "business_activated",
]);

export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  return PAID_PLAN_KEYS.has(String(planKey ?? ""));
}

export type VerificationGateInput = {
  isPaidPlan: boolean;
};

export type VerificationGateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; body: Record<string, unknown> };

/**
 * Pure gate used by bridge-customer / bridge-kyc-link / bridge-kyb-link before
 * any Bridge call. Order: env pause only.
 *
 * NOTE: KYC/KYB is automatic and free. Paid enforcement is on money-movement
 * functions, not verification start.
 */
export function verificationGate(_input: VerificationGateInput): VerificationGateResult {
  if (!bridgeOnboardingEnabled()) {
    return { allowed: false, code: BRIDGE_ONBOARDING_PAUSED_CODE, status: 503, body: bridgeOnboardingPausedBody() };
  }
  return { allowed: true };
}

/**
 * Reads the dynamic gate input from the DB, fail-closed (any read error →
 * not paid). `supa` is a service-role client. Used by the Bridge entry points
 * right after they authenticate the user.
 */
export async function loadVerificationContext(
  supa: { from: (t: string) => any },
  userId: string,
): Promise<VerificationGateInput> {
  let isPaidPlan = false;
  try {
    const { data: sub } = await supa
      .from("user_subscriptions")
      .select("plan_key, status")
      .eq("user_id", userId)
      .maybeSingle();
    isPaidPlan =
      isPaidPlanKey(sub?.plan_key) &&
      String(sub?.status ?? "").trim().toLowerCase() === "active";
  } catch { /* fail closed → treated as free */ }

  return { isPaidPlan };
}
