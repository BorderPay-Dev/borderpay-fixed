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
// Stepped verification gate.
//
// Bridge bills us per verification ($2 KYC / $10 KYB). We therefore NEVER call
// a Bridge verification endpoint unless these conditions hold:
//   1. onboarding is enabled (env, fail-closed)         — bridgeOnboardingEnabled()
//   2. BorderPay Terms of Service were accepted durably
//
// The env gate stays the OUTER guard, so while BRIDGE_ONBOARDING_ENABLED is off
// every caller still gets `bridge_onboarding_paused` and no behavior changes in
// production until this is explicitly enabled with a paired deploy.
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
 * verification call. Order: env pause → ToS.
 *
 * NOTE: KYC/KYB is now AUTOMATIC — Bridge runs verification and we react to its
 * webhook. There is NO admin manual-review step; that gate has been removed.
 * The remaining gates are the env launch-pause and durable ToS acceptance.
 */
export function verificationGate(input: VerificationGateInput): VerificationGateResult {
  if (!bridgeOnboardingEnabled()) {
    return { allowed: false, code: BRIDGE_ONBOARDING_PAUSED_CODE, status: 503, body: bridgeOnboardingPausedBody() };
  }
  if (!input.hasAcceptedTos) {
    return {
      allowed: false,
      code: TOS_REQUIRED_CODE,
      status: 409,
      body: {
        success: false,
        code: TOS_REQUIRED_CODE,
        error: "Accept BorderPay Terms of Service before starting verification.",
      },
    };
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
