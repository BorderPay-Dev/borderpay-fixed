/**
 * Money-movement paid gate (separate from the onboarding PAUSE in
 * launch-gates.ts on purpose).
 *
 * The onboarding pause (launch-gates.ts) must never bleed into money-movement
 * functions — that invariant is enforced by
 * tests/audit/bridge_onboarding_pause_and_header_audit.py (P4). So the paid
 * gate that money-movement functions DO need lives here, in its own module.
 *
 * Model (Wise funnel): KYC/KYB can be free, but moving money or provisioning a
 * money product requires an activated (paid) plan. An unpaid user gets
 * `plan_required`, which the app turns into the activation popup.
 */

export const PLAN_REQUIRED_CODE = "plan_required";

export type PlanGateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; body: Record<string, unknown> };

/**
 * Paid gate. Mirrors the inline check already in bridge-virtual-account.
 * Fail-closed: any read error → treated as free → blocked.
 */
export async function requireActivatedPlan(
  supa: { from: (t: string) => any },
  userId: string,
  isBusiness = false,
): Promise<PlanGateResult> {
  let planKey: string | null = null;
  try {
    const q = supa
      .from("user_subscriptions")
      .select("plan_key, status")
      .in("status", ["active", "trialing"])
      .maybeSingle();
    const { data: sub } = isBusiness
      ? await q.eq("business_user_id", userId)
      : await q.eq("user_id", userId);
    planKey = sub?.plan_key ?? null;
  } catch { /* fail closed → treated as free */ }

  if (!["individual_activated", "business_activated"].includes(String(planKey ?? ""))) {
    return {
      allowed: false,
      code: PLAN_REQUIRED_CODE,
      status: 402,
      body: {
        success: false,
        code: PLAN_REQUIRED_CODE,
        error: "Activate your BorderPay Global Wallet to move money.",
        upgrade_to:   isBusiness ? "business_activated" : "individual_activated",
        current_plan: planKey ?? (isBusiness ? "business_starter" : "individual_starter"),
      },
    };
  }
  return { allowed: true };
}
