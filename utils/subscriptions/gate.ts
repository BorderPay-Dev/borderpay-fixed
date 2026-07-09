/**
 * Legacy subscription helpers.
 *
 * Production no longer uses paid plans to gate KYC/KYB or money movement.
 * Provider verification, ToS, KYC/KYB status, balance, and product billing are
 * enforced in their respective flows.
 */

/** Legacy compatibility: plan state no longer gates production flows. */
export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

/** Legacy compatibility: plan state no longer gates production flows. */
export function requiresPaidPlan(planKey: string | null | undefined): boolean {
  void planKey;
  return false;
}

/** Gate for live transaction workflows (send/convert/withdraw). */
export function canMoveMoney(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

/** KYC/KYB is gated by ToS and provider checks, not paid plans. */
export function canStartVerification(planKey: string | null | undefined): boolean {
  void planKey;
  return true;
}

/**
 * Synchronous legacy activation check. Always true because production no longer
 * has paid-plan activation.
 */
export function isAccountActivated(): boolean {
  return true;
}

/** Cached plan key (or null). */
export function cachedPlanKey(): string | null {
  try { return localStorage.getItem('borderpay_plan_key'); } catch { return null; }
}
