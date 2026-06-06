/**
 * BorderPay Africa — account activation catalogue (one-time fee model).
 *
 * Billing model (Wise-style, bootstrapped): there are NO monthly subscriptions.
 * Each account type has two states:
 *   • a free, view-only DEFAULT state (…_starter) assigned at signup, and
 *   • an ACTIVATED state (…_activated) unlocked by a single ONE-TIME fee.
 *
 * The one-time activation fee is the absolute requirement to unlock multi-wallet
 * creation and to trigger the manual KYC/KYB review gate. The upfront cash also
 * clears the provider's KYC ($2) / KYB ($10) onboarding cost.
 *
 *   • individual_starter    Free (view-only)
 *   • individual_activated  $9.99 one-time — "Wallet Activation Fee"
 *   • business_starter      Free (view-only)
 *   • business_activated    $29.99 one-time — "Corporate Onboarding & Activation Fee"
 *
 * After activation, active virtual accounts incur a monthly maintenance fee
 * debited directly from wallet balance (no markup) — see the maintenance logic
 * in the backend; outbound money movement is blocked while underfunded.
 *
 * Activation is charged from a USD virtual-account balance via the atomic
 * `pay_subscription_invoice_from_va` RPC (one-time, no recurring period).
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
  /** ONE-TIME activation fee in USD cents. 0 = free/default (not activated). */
  activation_fee_usd: number;
  limits:            PlanLimits;
  features:          readonly PlanFeature[];
  cta_label:         string;
  /** Marks the free tier auto-assigned at signup. */
  is_default:        boolean;
  /** True for the paid, activated state. */
  is_activated:      boolean;
}

/** Flat business team-seat default (no Growth/Enterprise tiers). */
const BUSINESS_TEAM_SEATS = 10;

export const PLANS: Readonly<Record<PlanKey, PlanDef>> = {
  individual_starter: {
    key:                'individual_starter',
    account_type:       'individual',
    display_name:       'Starter',
    tagline:            'View-only. Activate to open your wallets.',
    activation_fee_usd: 0,
    limits: { va_currencies: [], max_team_members: null, cards_enabled: false },
    features: [
      { title: 'Browse the app' },
      { title: 'Live exchange rates' },
      { title: 'Activate to unlock USD / EUR / GBP wallets' },
    ],
    cta_label:          'Get started',
    is_default:         true,
    is_activated:       false,
  },

  individual_activated: {
    key:                'individual_activated',
    account_type:       'individual',
    display_name:       'Activated',
    tagline:            'One-time fee. Multi-currency wallets unlocked.',
    activation_fee_usd: 999,
    limits: { va_currencies: ['USD', 'EUR', 'GBP'], max_team_members: null, cards_enabled: false },
    features: [
      { title: 'USD virtual account (ACH)',             highlight: true },
      { title: 'EUR virtual account (SEPA)',            highlight: true },
      { title: 'GBP virtual account (Faster Payments)', highlight: true },
      { title: 'All stablecoin wallets' },
      { title: 'Identity verification included' },
    ],
    cta_label:          'Activate — $9.99 one-time',
    is_default:         false,
    is_activated:       true,
  },

  business_starter: {
    key:                'business_starter',
    account_type:       'business',
    display_name:       'Starter',
    tagline:            'View-only. Activate to onboard your business.',
    activation_fee_usd: 0,
    limits: { va_currencies: [], max_team_members: BUSINESS_TEAM_SEATS, cards_enabled: false },
    features: [
      { title: 'Browse the app' },
      { title: 'Live exchange rates' },
      { title: 'Activate to unlock business wallets + team' },
    ],
    cta_label:          'Get started',
    is_default:         true,
    is_activated:       false,
  },

  business_activated: {
    key:                'business_activated',
    account_type:       'business',
    display_name:       'Activated',
    tagline:            'One-time onboarding. Corporate wallets unlocked.',
    activation_fee_usd: 2999,
    limits: { va_currencies: ['USD', 'EUR', 'GBP'], max_team_members: BUSINESS_TEAM_SEATS, cards_enabled: false },
    features: [
      { title: 'USD / EUR / GBP business virtual accounts', highlight: true },
      { title: `Up to ${BUSINESS_TEAM_SEATS} team members`,  highlight: true },
      { title: 'All stablecoin wallets' },
      { title: 'Business verification (KYB) included' },
      { title: 'Cross-border payments' },
    ],
    cta_label:          'Activate — $29.99 one-time',
    is_default:         false,
    is_activated:       true,
  },
} as const;

// ── Helper getters ──────────────────────────────────────────────────────────

export function getPlan(key: PlanKey): PlanDef {
  return PLANS[key];
}

/** Free default plan auto-assigned at signup for an account type. */
export function getDefaultPlanFor(accountType: AccountType): PlanDef {
  return accountType === 'business' ? PLANS.business_starter : PLANS.individual_starter;
}

/** The paid, activated plan an account type upgrades into. */
export function getActivatedPlanFor(accountType: AccountType): PlanDef {
  return accountType === 'business' ? PLANS.business_activated : PLANS.individual_activated;
}

export function listPlansFor(accountType: AccountType): readonly PlanDef[] {
  return Object.values(PLANS).filter(p => p.account_type === accountType);
}

/** True for the paid activated state (the gate for money movement / KYC-KYB). */
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

/** Formatted display price, e.g. "$9.99 one-time" or "Free". */
export function formatPlanPrice(plan: PlanDef): string {
  if (plan.activation_fee_usd === 0) return 'Free';
  return `$${(plan.activation_fee_usd / 100).toFixed(2)} one-time`;
}
