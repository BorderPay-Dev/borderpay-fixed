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
 * Legacy compatibility flag. KYC/KYB is not payment-gated.
 */
export function kycRequiresPayment(): boolean {
  return (Deno.env.get("KYC_REQUIRES_PAYMENT") || "false").trim().toLowerCase() === "true";
}

export function bridgeOnboardingPausedBody() {
  return {
    success: false,
    code: BRIDGE_ONBOARDING_PAUSED_CODE,
    error: "Verification is paused until BorderPay launches money movement. You can keep using your account.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stepped verification gate (#4 + #5).
//
// Bridge verification/customer calls are allowed only when onboarding is
// enabled. Customer access is then controlled by Bridge KYC/KYB status.
//
// The env gate stays the OUTER guard, so while BRIDGE_ONBOARDING_ENABLED is off
// every caller still gets `bridge_onboarding_paused` and no behavior changes in
// production until this is explicitly enabled with a paired deploy.
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_REQUIRED_CODE       = "payment_required";

export const PAID_PLAN_KEYS: ReadonlySet<string> = new Set([
  "individual_activated",
  "business_activated",
]);

export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

export type VerificationGateInput = {
  isPaidPlan: boolean;
};

export type VerificationGateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; body: Record<string, unknown> };

/**
 * Pure gate used by bridge-customer / bridge-kyc-link / bridge-kyb-link before
 * any Bridge call. Order: env pause → legacy compatibility payment flag.
 *
 * NOTE: KYC/KYB is now AUTOMATIC — Bridge runs verification and we react to its
 * webhook. There is NO admin manual-review step; that gate has been removed.
 * The only gates left are
 * the env launch-pause and the payment flag (off in the Wise funnel, where the
 * paid gate lives on money-movement instead).
 */
export function verificationGate(input: VerificationGateInput): VerificationGateResult {
  if (!bridgeOnboardingEnabled()) {
    return { allowed: false, code: BRIDGE_ONBOARDING_PAUSED_CODE, status: 503, body: bridgeOnboardingPausedBody() };
  }
  if (kycRequiresPayment() && !input.isPaidPlan) {
    return {
      allowed: false,
      code: PAYMENT_REQUIRED_CODE,
      status: 402,
      body: {
        success: false,
        code: PAYMENT_REQUIRED_CODE,
        error: "Verify your account to unlock BorderPay services.",
      },
    };
  }
  return { allowed: true };
}

/**
 * Legacy context loader retained for older call sites.
 */
export async function loadVerificationContext(
  supa: { from: (t: string) => any },
  userId: string,
): Promise<VerificationGateInput> {
  let isPaidPlan = true;
  try {
    const { data: sub } = await supa
      .from("user_subscriptions")
      .select("plan_key, status")
      .eq("user_id", userId)
      .maybeSingle();
    isPaidPlan =
      isPaidPlanKey(sub?.plan_key) &&
      String(sub?.status ?? "").trim().toLowerCase() === "active";
  } catch { /* compatibility only */ }

  return { isPaidPlan: true };
}
