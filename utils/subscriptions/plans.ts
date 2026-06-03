/**
 * BorderPay Africa — Subscription plan catalogue.
 *
 * Single source of truth for tier definitions. Consumers: pricing page,
 * paywall modals, tier enforcement guards in partner endpoints.
 *
 * Billing model: WALLET-DEBIT (not Stripe). The upgrade flow charges a
 * USD virtual-account balance via the atomic `pay_subscription_invoice_from_va`
 * RPC. See `supabase/functions/subscription-upgrade/index.ts` for the
 * transactional path.
 *
 * Plans:
 *   • individual_starter    Free
 *   • individual_premium    $9.99 / month
 *   • business_starter      Free
 *   • business_growth       $29.99 / month
 *   • business_enterprise   Contact sales (no programmatic price)
 *
 * Each entry declares:
 *   • account_type      'individual' | 'business'
 *   • price_monthly_usd numeric cents (0 for free; 999 / 2999; null = contact sales)
 *   • limits            tier guardrails enforced server-side
 *   • features          marketing bullet list for /pricing
 */

export type PlanKey =
  | 'individual_starter'
  | 'individual_premium'
  | 'business_starter'
  | 'business_growth'
  | 'business_enterprise';

export type AccountType = 'individual' | 'business';

export interface PlanLimits {
  /** ISO-4217 codes for virtual accounts the user can provision. */
  va_currencies:    readonly ('USD' | 'EUR' | 'GBP')[];
  /** Team seats including owner. null = unlimited. */
  max_team_members: number | null;
  /** True once Cards launch — tier-gated card issuance. */
  cards_enabled:    boolean;
}

export interface PlanFeature {
  title: string;
  highlight?: boolean;
}

export interface PlanDef {
  key:                PlanKey;
  account_type:       AccountType;
  display_name:       string;
  tagline:            string;
  /** USD cents per month; 0 for free tiers. Enterprise = null (contact sales). */
  price_monthly_usd:  number | null;
  limits:             PlanLimits;
  features:           readonly PlanFeature[];
  cta_label:          string;
  is_default:         boolean;        // marks the free tier auto-assigned at signup
  is_contact_sales:   boolean;
}

export const PLANS: Readonly<Record<PlanKey, PlanDef>> = {
  individual_starter: {
    key:               'individual_starter',
    account_type:      'individual',
    display_name:      'Starter',
    tagline:           'Get a USD account in minutes.',
    price_monthly_usd: 0,
    limits: {
      va_currencies:    ['USD'],
      max_team_members: null,
      cards_enabled:    false,
    },
    features: [
      { title: '1 USD virtual account (ACH)' },
      { title: 'Stablecoin wallets (USDC, USDT, USDB, PYUSD)' },
      { title: 'Send / receive across supported rails' },
      { title: 'BorderPay identity verification' },
      { title: 'Cards locked until enabled' },
    ],
    cta_label:        'Start free',
    is_default:       true,
    is_contact_sales: false,
  },

  individual_premium: {
    key:               'individual_premium',
    account_type:      'individual',
    display_name:      'Premium',
    tagline:           'Three global accounts. One subscription.',
    price_monthly_usd: 999,
    limits: {
      va_currencies:    ['USD', 'EUR', 'GBP'],
      max_team_members: null,
      cards_enabled:    false,
    },
    features: [
      { title: 'USD virtual account (ACH)',           highlight: true },
      { title: 'EUR virtual account (SEPA)',          highlight: true },
      { title: 'GBP virtual account (Faster Payments)', highlight: true },
      { title: 'All stablecoin wallets' },
      { title: 'Higher transfer limits' },
      { title: 'Priority customer support' },
      { title: 'Cards locked until enabled' },
    ],
    cta_label:        'Upgrade to Premium',
    is_default:       false,
    is_contact_sales: false,
  },

  business_starter: {
    key:               'business_starter',
    account_type:      'business',
    display_name:      'Starter',
    tagline:           'Launch your business with a USD account.',
    price_monthly_usd: 0,
    limits: {
      va_currencies:    ['USD'],
      max_team_members: 5,
      cards_enabled:    false,
    },
    features: [
      { title: '1 USD business virtual account' },
      { title: 'Up to 5 team members' },
      { title: 'Stablecoin wallets' },
      { title: 'BorderPay business verification' },
      { title: 'Cross-border payments' },
      { title: 'Cards locked until enabled' },
    ],
    cta_label:        'Start free',
    is_default:       true,
    is_contact_sales: false,
  },

  business_growth: {
    key:               'business_growth',
    account_type:      'business',
    display_name:      'Growth',
    tagline:           'Multi-currency treasury for growing teams.',
    price_monthly_usd: 2999,
    limits: {
      va_currencies:    ['USD', 'EUR', 'GBP'],
      max_team_members: 20,
      cards_enabled:    false,
    },
    features: [
      { title: 'USD / EUR / GBP virtual accounts', highlight: true },
      { title: 'Up to 20 team members',            highlight: true },
      { title: 'All stablecoin wallets' },
      { title: 'Advanced treasury features' },
      { title: 'Role-based access control' },
      { title: 'Priority support' },
      { title: 'Cards locked until enabled' },
    ],
    cta_label:        'Upgrade to Growth',
    is_default:       false,
    is_contact_sales: false,
  },

  business_enterprise: {
    key:               'business_enterprise',
    account_type:      'business',
    display_name:      'Enterprise',
    tagline:           'Custom scale, dedicated support.',
    price_monthly_usd: null,
    limits: {
      va_currencies:    ['USD', 'EUR', 'GBP'],
      max_team_members: null,
      cards_enabled:    false,
    },
    features: [
      { title: 'Unlimited team members',          highlight: true },
      { title: 'Custom transfer limits',          highlight: true },
      { title: 'Dedicated account manager',       highlight: true },
      { title: 'SLA + uptime guarantees' },
      { title: 'Custom integrations / API access' },
      { title: 'Advanced compliance reporting' },
      { title: 'Cards locked until enabled' },
    ],
    cta_label:        'Contact sales',
    is_default:       false,
    is_contact_sales: true,
  },
} as const;

// ── Helper getters ──────────────────────────────────────────────────────────

export function getPlan(key: PlanKey): PlanDef {
  return PLANS[key];
}

export function getDefaultPlanFor(accountType: AccountType): PlanDef {
  return accountType === 'business' ? PLANS.business_starter : PLANS.individual_starter;
}

export function listPlansFor(accountType: AccountType): readonly PlanDef[] {
  return Object.values(PLANS).filter(p => p.account_type === accountType);
}

/**
 * True if a plan key permits virtual-account creation in the given currency.
 * Used by bridge-virtual-account to gate EUR/GBP creation on Premium/Growth.
 */
export function planAllowsCurrency(planKey: PlanKey, currency: 'USD' | 'EUR' | 'GBP'): boolean {
  const p = PLANS[planKey];
  if (!p) return false;
  return (p.limits.va_currencies as readonly string[]).includes(currency);
}

/**
 * True if the plan permits adding another team seat given the current count.
 * `currentCount` includes the owner. `null` max means unlimited.
 */
export function planAllowsTeamSeat(planKey: PlanKey, currentCount: number): boolean {
  const p = PLANS[planKey];
  if (!p) return false;
  const max = p.limits.max_team_members;
  return max === null || currentCount < max;
}

/** Formatted display price, e.g. "$9.99 / month", "Free", "Contact sales". */
export function formatPlanPrice(plan: PlanDef): string {
  if (plan.is_contact_sales) return 'Contact sales';
  if (plan.price_monthly_usd === 0 || plan.price_monthly_usd == null) return 'Free';
  const dollars = (plan.price_monthly_usd / 100).toFixed(2);
  return `$${dollars} / month`;
}
