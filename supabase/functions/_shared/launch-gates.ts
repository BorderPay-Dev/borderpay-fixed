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
