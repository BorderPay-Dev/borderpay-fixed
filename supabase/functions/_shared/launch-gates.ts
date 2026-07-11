/**
 * BorderPay launch gates.
 *
 * These gates intentionally fail closed only for the outer launch switch. Bridge
 * hosted onboarding owns ToS + KYC/KYB collection; the app must not block users
 * behind a local BorderPay ToS row before requesting the Bridge hosted link.
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
// Verification gate.
//
// Bridge hosted KYC/KYB collects Bridge Terms of Service as part of the hosted
// flow. Do not require local `tos_accepted_at` here; doing so prevents the app
// from ever receiving the Bridge ToS/KYC/KYB URL and blocks live onboarding.
//
// The env gate stays the OUTER guard, so while BRIDGE_ONBOARDING_ENABLED is off
// every caller still gets `bridge_onboarding_paused`.
// ─────────────────────────────────────────────────────────────────────────────

export const TOS_REQUIRED_CODE           = "tos_required";

export type VerificationGateInput = {
  hasAcceptedTos: boolean;
};

export type VerificationGateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; body: Record<string, unknown> };

/**
 * Pure gate used by bridge-kyc-link / bridge-kyb-link before any Bridge
 * verification call. Bridge ToS happens inside the provider-hosted flow.
 */
export function verificationGate(input: VerificationGateInput): VerificationGateResult {
  void input;
  if (!bridgeOnboardingEnabled()) {
    return { allowed: false, code: BRIDGE_ONBOARDING_PAUSED_CODE, status: 503, body: bridgeOnboardingPausedBody() };
  }
  return { allowed: true };
}

/**
 * Reads durable ToS state from the DB, fail-closed. `supa` is a service-role
 * client. Used by the Bridge entry points right after they authenticate the
 * user.
 */
export async function loadVerificationContext(
  supa: { from: (t: string) => any },
  userId: string,
): Promise<VerificationGateInput> {
  let hasAcceptedTos = false;
  try {
    const { data: profile } = await supa
      .from("user_profiles")
      .select("tos_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    hasAcceptedTos = Boolean(profile?.tos_accepted_at);
  } catch { /* fail closed → treated as not accepted */ }

  return { hasAcceptedTos };
}
