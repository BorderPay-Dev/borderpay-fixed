/**
 * Money-movement / verification plan gate (#5).
 *
 * Single source of truth (frontend) for "is this plan allowed to move money /
 * start billable verification". Mirrors the server-side PAID_PLAN_KEYS in
 * supabase/functions/_shared/launch-gates.ts — kept in sync by
 * tests/audit/verification_paywall_gate_audit.py.
 *
 * Model: Free tiers (individual_starter / business_starter) are view-only.
 * Live transaction workflows and billable Bridge KYC/KYB are unlocked only on
 * a PAID plan. Enterprise (contact-sales, no monthly price) counts as paid.
 */

import { isActivatedPlanKey } from './plans';

/** True once the one-time activation fee is paid (the activated plan). */
export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  return isActivatedPlanKey(planKey);
}

/** Free/un-activated accounts must pay the activation fee before money movement. */
export function requiresPaidPlan(planKey: string | null | undefined): boolean {
  return !isPaidPlanKey(planKey);
}

/** Gate for live transaction workflows (send/convert/withdraw). */
export function canMoveMoney(planKey: string | null | undefined): boolean {
  return isPaidPlanKey(planKey);
}

/** Gate for starting billable Bridge KYC/KYB (only after a paid plan). */
export function canStartVerification(planKey: string | null | undefined): boolean {
  return isPaidPlanKey(planKey);
}
