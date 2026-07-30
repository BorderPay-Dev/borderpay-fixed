/** Legacy money-movement gate retained for older imports.
 * Customer access is governed by Bridge KYC/KYB and provider controls. */

export const PLAN_REQUIRED_CODE = "plan_required";

export type PlanGateResult =
  | { allowed: true }
  | { allowed: false; code: string; status: number; body: Record<string, unknown> };

export async function requireActivatedPlan(
  supa: { from: (t: string) => any },
  userId: string,
  isBusiness = false,
): Promise<PlanGateResult> {
  void supa;
  void userId;
  void isBusiness;
  return { allowed: true };
}
