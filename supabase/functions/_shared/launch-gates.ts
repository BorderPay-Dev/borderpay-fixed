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
export const PENDING_MANUAL_REVIEW_CODE  = "pending_manual_review";

/** Paid plan keys (price > 0 in utils/subscriptions/plans.ts). Free tiers
 *  (individual_starter / business_starter) are intentionally excluded — Free is
 *  view-only and never triggers a billable Bridge call. */
export const PAID_PLAN_KEYS: ReadonlySet<string> = new Set([
  "individual_premium",
  "business_growth",
  "business_enterprise",
]);

export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  return PAID_PLAN_KEYS.has(String(planKey ?? ""));
}

/** Canonical verification review state (mirrors user_profiles.verification_review_status). */
export const VERIFICATION_AUTHORIZED = "authorized";

export type VerificationGateInput = {
  isPaidPlan:   boolean;
  reviewStatus: string | null | undefined; // 'pending_manual_review' | 'authorized' | 'rejected'
};

export type VerificationGateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; body: Record<string, unknown> };

/**
 * Pure gate used by bridge-customer / bridge-kyc-link / bridge-kyb-link before
 * any Bridge call. Order matters: env pause → payment → manual review.
 */
export function verificationGate(input: VerificationGateInput): VerificationGateResult {
  if (!bridgeOnboardingEnabled()) {
    return { allowed: false, code: BRIDGE_ONBOARDING_PAUSED_CODE, status: 503, body: bridgeOnboardingPausedBody() };
  }
  if (!input.isPaidPlan) {
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
  if (String(input.reviewStatus ?? "").trim().toLowerCase() !== VERIFICATION_AUTHORIZED) {
    return {
      allowed: false,
      code: PENDING_MANUAL_REVIEW_CODE,
      status: 403,
      body: {
        success: false,
        code: PENDING_MANUAL_REVIEW_CODE,
        error: "Your account is pending manual review. We'll email you when document upload is enabled.",
      },
    };
  }
  return { allowed: true };
}

/**
 * Reads the two dynamic gate inputs from the DB, fail-closed (any read error →
 * not paid / not authorized). `supa` is a service-role client. Used by the
 * Bridge entry points right after they authenticate the user.
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

  let reviewStatus: string | null = null;
  try {
    const { data: prof } = await supa
      .from("user_profiles")
      .select("verification_review_status")
      .eq("id", userId)
      .maybeSingle();
    reviewStatus = prof?.verification_review_status ?? null;
  } catch { /* fail closed → treated as not authorized */ }

  return { isPaidPlan, reviewStatus };
}
