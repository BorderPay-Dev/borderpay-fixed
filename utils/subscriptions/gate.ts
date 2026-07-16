/**
 * Legacy frontend compatibility gate.
 *
 * BorderPay customer access is governed by verification/KYC/KYB.
 */

export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

export function requiresPaidPlan(planKey: string | null | undefined): boolean {
  void planKey;
  return false;
}

export function canMoveMoney(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

export function canStartVerification(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

export function isAccountActivated(): boolean {
  return true;
}

export function cachedPlanKey(): string | null {
  try { return localStorage.getItem('borderpay_plan_key'); } catch { return null; }
}
