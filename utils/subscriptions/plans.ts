/**
 * BorderPay Africa — legacy access catalogue.
 *
 * Kept for database/API compatibility only. Customer access is governed by
 * verification/KYC/KYB.
 */

export type PlanKey =
  | 'individual_starter'
  | 'individual_activated'
  | 'business_starter'
  | 'business_activated';

export type AccountType = 'individual' | 'business';

export interface PlanLimits {
  /** ISO-4217 codes for virtual accounts the user can provision once activated. */
  va_currencies:    readonly ('USD' | 'EUR' | 'GBP')[];
  /** Team seats including owner. null = unlimited / N/A (individual). */
  max_team_members: number | null;
  /** True once Cards launch — tier-gated card issuance. */
  cards_enabled:    boolean;
}

export interface PlanFeature {
  title: string;
  highlight?: boolean;
}

export interface PlanDef {
  key:               PlanKey;
  account_type:      AccountType;
  display_name:      string;
  tagline:           string;
  /** Legacy field retained for API compatibility. Always 0. */
  activation_fee_usd: number;
  limits:            PlanLimits;
  features:          readonly PlanFeature[];
  cta_label:         string;
  /** Marks the default row auto-assigned at signup. */
  is_default:        boolean;
  /** Legacy field. Access is governed by verification, not plan payment. */
  is_activated:      boolean;
}

/** Flat business team-seat default (no Growth/Enterprise tiers). */
const BUSINESS_TEAM_SEATS = 10;

export const PLANS: Readonly<Record<PlanKey, PlanDef>> = {
  individual_starter: {
    key:                'individual_starter',
    account_type:       'individual',
    display_name:       'Individual',
    tagline:            'Verify your identity to unlock BorderPay accounts.',
    activation_fee_usd: 0,
    limits: { va_currencies: [], max_team_members: null, cards_enabled: false },
    features: [
      { title: 'Identity verification' },
      { title: 'USD / EUR / GBP accounts after approval' },
      { title: 'Stablecoin wallets where supported' },
    ],
    cta_label:          'Get started',
    is_default:         true,
    is_activated:       false,
  },

  individual_activated: {
    key:                'individual_activated',
    account_type:       'individual',
    display_name:       'Verified individual',
    tagline:            'Identity verified. Multi-currency accounts available.',
    activation_fee_usd: 0,
    limits: { va_currencies: ['USD', 'EUR', 'GBP'], max_team_members: null, cards_enabled: false },
    features: [
      { title: 'USD virtual account (ACH)',             highlight: true },
      { title: 'EUR virtual account (SEPA)',            highlight: true },
      { title: 'GBP virtual account (Faster Payments)', highlight: true },
      { title: 'All stablecoin wallets' },
      { title: 'Identity verification included' },
    ],
    cta_label:          'Verify account',
    is_default:         false,
    is_activated:       true,
  },

  business_starter: {
    key:                'business_starter',
    account_type:       'business',
    display_name:       'Business',
    tagline:            'Verify your business to unlock BorderPay accounts.',
    activation_fee_usd: 0,
    limits: { va_currencies: [], max_team_members: BUSINESS_TEAM_SEATS, cards_enabled: false },
    features: [
      { title: 'Business verification' },
      { title: 'Business wallets and team access after approval' },
      { title: 'Cross-border payments' },
    ],
    cta_label:          'Get started',
    is_default:         true,
    is_activated:       false,
  },

  business_activated: {
    key:                'business_activated',
    account_type:       'business',
    display_name:       'Verified business',
    tagline:            'Business verified. Corporate wallets available.',
    activation_fee_usd: 0,
    limits: { va_currencies: ['USD', 'EUR', 'GBP'], max_team_members: BUSINESS_TEAM_SEATS, cards_enabled: false },
    features: [
      { title: 'USD / EUR / GBP business virtual accounts', highlight: true },
      { title: `Up to ${BUSINESS_TEAM_SEATS} team members`,  highlight: true },
      { title: 'All stablecoin wallets' },
      { title: 'Business verification (KYB) included' },
      { title: 'Cross-border payments' },
    ],
    cta_label:          'Verify business',
    is_default:         false,
    is_activated:       true,
  },
} as const;

// ── Helper getters ──────────────────────────────────────────────────────────

export function getPlan(key: PlanKey): PlanDef {
  return PLANS[key];
}

/** Default compatibility row auto-assigned at signup for an account type. */
export function getDefaultPlanFor(accountType: AccountType): PlanDef {
  return accountType === 'business' ? PLANS.business_starter : PLANS.individual_starter;
}

/** Legacy verified-state row for an account type. */
export function getActivatedPlanFor(accountType: AccountType): PlanDef {
  return accountType === 'business' ? PLANS.business_activated : PLANS.individual_activated;
}

export function listPlansFor(accountType: AccountType): readonly PlanDef[] {
  return Object.values(PLANS).filter(p => p.account_type === accountType);
}

/** Legacy helper. Customer access is governed by verification, not payment. */
export function isActivatedPlanKey(planKey: string | null | undefined): boolean {
  const p = PLANS[planKey as PlanKey];
  return !!p && p.is_activated;
}

/** True if a plan permits virtual-account creation in the given currency. */
export function planAllowsCurrency(planKey: PlanKey, currency: 'USD' | 'EUR' | 'GBP'): boolean {
  const p = PLANS[planKey];
  if (!p) return false;
  return (p.limits.va_currencies as readonly string[]).includes(currency);
}

/** True if the plan permits another team seat given the current count (incl. owner). */
export function planAllowsTeamSeat(planKey: PlanKey, currentCount: number): boolean {
  const p = PLANS[planKey];
  if (!p) return false;
  const max = p.limits.max_team_members;
  return max === null || currentCount < max;
}

/** Formatted display threshold, e.g. "Min balance $20.00" or "Free". */
export function formatPlanPrice(plan: PlanDef): string {
  if (plan.activation_fee_usd === 0) return 'Free';
  return `Min balance $${(plan.activation_fee_usd / 100).toFixed(2)}`;
}
