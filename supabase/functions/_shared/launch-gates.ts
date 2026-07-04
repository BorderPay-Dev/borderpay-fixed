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
 * Whether KYC/KYB must be PRECEDED by the one-time activation payment.
 *
 * - true  (default): current "pay → verify" model. verificationGate enforces
 *                    payment_required before any Bridge KYC/KYB call.
 * - false: "Wise" funnel — free signup → KYC/KYB (free) → dashboard → pay on
 *          Send/Receive. KYC is no longer payment-gated; the paid gate moves to
 *          the money-movement functions (bridge-transfer / bridge-wallet /
 *          bridge-external-account / bridge-virtual-account).
 *
 * Defaults to TRUE so production behavior is UNCHANGED until the operator sets
 * KYC_REQUIRES_PAYMENT=false in the SAME deploy that confirms every money-
 * movement function is paid-gated (see requireActivatedPlan). Fail-safe: an
 * unset/garbage value keeps payment required.
 */
export function kycRequiresPayment(): boolean {
  return (Deno.env.get("KYC_REQUIRES_PAYMENT") || "true").trim().toLowerCase() !== "false";
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
// Bridge bills us per verification ($2 KYC / $10 KYB). We therefore NEVER call
// a Bridge verification/customer endpoint unless ALL THREE hold:
//   1. onboarding is enabled (env, fail-closed)         — bridgeOnboardingEnabled()
//   2. the user is on a PAID plan (no Bridge spend on free users)
//   3. an admin has AUTHORIZED the verification (manual review of KYC *and* KYB)
//
// The env gate stays the OUTER guard, so while BRIDGE_ONBOARDING_ENABLED is off
// every caller still gets `bridge_onboarding_paused` and no behavior changes in
// production until this is explicitly enabled with a paired deploy.
// ─────────────────────────────────────────────────────────────────────────────

export const PAYMENT_REQUIRED_CODE       = "payment_required";

/** Activated plan keys (one-time activation fee paid; see plans.ts). Free
 *  tiers (individual_starter / business_starter) are intentionally excluded —
 *  Free is view-only and never triggers a billable Bridge call. */
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
 * any Bridge call. Order: env pause → (optional) payment.
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
  // Payment-before-KYC is enforced only in the "pay → verify" model. In the
  // Wise funnel (KYC_REQUIRES_PAYMENT=false) KYC/KYB is free and the paid gate
  // lives on the money-movement functions instead.
  if (kycRequiresPayment() && !input.isPaidPlan) {
    return {
      allowed: false,
      code: PAYMENT_REQUIRED_CODE,
      status: 402,
      body: {
        success: false,
        code: PAYMENT_REQUIRED_CODE,
        error: "Upgrade to a paid plan to start identity verification.",
      },
    };
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
