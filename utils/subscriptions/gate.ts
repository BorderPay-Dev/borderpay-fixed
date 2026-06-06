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

import { PLANS, type PlanKey } from './plans';

/** True for paid plans (monthly price > 0, or enterprise/contact-sales). */
export function isPaidPlanKey(planKey: string | null | undefined): boolean {
  const p = PLANS[planKey as PlanKey];
  if (!p) return false;
  if (p.is_contact_sales) return true;               // enterprise = paid
  return (p.price_monthly_usd ?? 0) > 0;
}

/** Free plans must upgrade before money movement / verification. */
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
