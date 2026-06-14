/**
 * BorderPay Pricing — premium fintech aesthetic, mobile-first.
 *
 * Renders the plan catalogue defined in utils/subscriptions/plans.ts.
 * If signed in, highlights the user's current plan and routes the
 * upgrade CTA into <UpgradeModal/>. Signed-out users see the same grid
 * with CTAs that route to signup.
 *
 * Layout:
 *   • Hero band with eyebrow + headline + currency note.
 *   • Account-type segmented toggle (Individual / Business).
 *   • Plan grid: 2 cards for individual, 3 for business.
 *   • Active plan: outlined in lime, "Current plan" tag.
 *   • Coming-soon items (cards) shown as muted footnotes.
 *
 * Design references: Mercury accounts, Ramp.
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Sparkles, Building2, User as UserIcon } from 'lucide-react';
import {
  PLANS,
  listPlansFor,
  formatPlanPrice,
  type AccountType,
  type PlanDef,
  type PlanKey,
} from '../../utils/subscriptions/plans';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export interface PricingScreenProps {
  /** Set when the viewer is signed in. Plan_key of their current subscription. */
  currentPlanKey?:  PlanKey | null;
  /** Set when the viewer is signed in. Their account type. */
  accountType?:     AccountType;
  /** Called when user clicks an upgrade CTA. */
  onUpgrade?:       (planKey: PlanKey) => void;
  /** Called when signed-out user clicks Start free. */
  onSignUp?:        () => void;
  /** Optional back affordance (when navigated to as a page within the app). */
  onBack?:          () => void;
  /** When true, this is in the signed-in app shell (already has back nav). */
  insideApp?:       boolean;
}

export function PricingScreen({
  currentPlanKey, accountType, onUpgrade, onSignUp, onBack, insideApp,
}: PricingScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  // For signed-out viewers, default to individual; signed-in viewers see
  // the plan grid for their own account type by default but can browse the
  // other side if they want.
  const [selectedType, setSelectedType] = useState<AccountType>(accountType ?? 'individual');

  const plans = useMemo(() => listPlansFor(selectedType), [selectedType]);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      {!insideApp && onBack && (
        <div className={`sticky top-0 z-10 ${tc.headerBg} border-b ${tc.borderLight}`}>
          <div className="max-w-screen-lg mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={onBack} aria-label={tt('common.back', 'Back')}
                    className={`p-2 -ml-2 rounded-full ${tc.hoverBg}`}>
              <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
            </button>
            <h1 className={`text-base font-semibold ${tc.text}`}>{tt('pricing.title', 'Plans & pricing')}</h1>
          </div>
        </div>
      )}

      {/* ── Hero band ─────────────────────────────────────────────────── */}
      <section className="px-4 py-10 sm:py-16 max-w-screen-lg mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${tc.textMuted} mb-3`}>
            <Sparkles className="w-3 h-3 text-[#C7FF00]" />
            {tt('pricing.eyebrow', 'BorderPay Plans')}
          </span>
          <h1 className={`text-3xl sm:text-5xl font-bold ${tc.text} tracking-tight`}>
            {tt('pricing.headline', 'Global accounts. Honest pricing.')}
          </h1>
          <p className={`mt-4 text-base sm:text-lg ${tc.textSecondary} max-w-2xl mx-auto`}>
            {tt(
              'pricing.subhead',
              'Start free. Keep at least $20 in your BorderPay wallet to unlock USD, EUR & GBP accounts — no subscriptions, no fees deducted. Your funds remain yours.',
            )}
          </p>
          <p className={`mt-2 text-xs ${tc.textMuted}`}>
            {tt('pricing.currency_note', 'One-time fee shown in USD, charged once from your selected USD virtual account. Active virtual accounts incur a small monthly maintenance fee from your wallet balance.')}
          </p>
        </motion.div>

        {/* Account-type toggle */}
        <div className={`mt-8 inline-flex rounded-full ${tc.glass} p-1 border ${tc.cardBorder}`}>
          <SegmentButton
            active={selectedType === 'individual'}
            label={tt('pricing.segment.individual', 'Individual')}
            Icon={UserIcon}
            onClick={() => setSelectedType('individual')}
          />
          <SegmentButton
            active={selectedType === 'business'}
            label={tt('pricing.segment.business', 'Business')}
            Icon={Building2}
            onClick={() => setSelectedType('business')}
          />
        </div>
      </section>

      {/* ── Plan grid ─────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-screen-lg mx-auto">
        <div className={`grid gap-4 sm:gap-5 ${plans.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {plans.map(plan => (
            <PlanCard
              key={plan.key}
              plan={plan}
              isCurrent={currentPlanKey === plan.key}
              canUpgrade={!!onUpgrade && plan.is_activated && currentPlanKey !== plan.key}
              signedIn={!!currentPlanKey || !!accountType}
              onUpgrade={onUpgrade}
              onSignUp={onSignUp}
              tc={tc}
              tt={tt}
            />
          ))}
        </div>

        <p className={`mt-10 text-center text-xs ${tc.textMuted} max-w-2xl mx-auto`}>
          {tt(
            'pricing.footnote',
            'Cards and local-currency rails are not live yet. Available account and wallet options depend on your country.',
          )}
        </p>
      </section>
    </div>
  );
}

function SegmentButton({
  active, label, Icon, onClick,
}: {
  active: boolean;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
        ${active ? 'bg-[#C7FF00] text-black' : 'text-white/70 hover:text-white'}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function PlanCard({
  plan, isCurrent, canUpgrade, signedIn, onUpgrade, onSignUp, tc, tt,
}: {
  plan:       PlanDef;
  isCurrent:  boolean;
  canUpgrade: boolean;
  signedIn:   boolean;
  onUpgrade?: (planKey: PlanKey) => void;
  onSignUp?:  () => void;
  tc:         ReturnType<typeof useThemeClasses>;
  tt:         (k: string, fb: string) => string;
}) {
  const isPaid = plan.is_activated;

  const ringClass = isCurrent
    ? 'ring-2 ring-[#C7FF00] shadow-[0_0_0_4px_rgba(199,255,0,0.15)]'
    : isPaid
      ? `border ${tc.cardBorder}`
      : `border ${tc.cardBorder}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: 'easeOut' }}
      className={`relative ${tc.card} rounded-3xl p-6 sm:p-7 flex flex-col ${ringClass}`}
    >
      {isPaid && (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#C7FF00] text-black text-[10px] font-bold tracking-[0.14em] uppercase">
          <Sparkles className="w-2.5 h-2.5" />
          {tt('pricing.popular', 'Popular')}
        </span>
      )}
      {isCurrent && (
        <span className="absolute top-4 right-4 inline-flex px-2 py-1 rounded-full bg-[#C7FF00] text-black text-[10px] font-bold tracking-wider uppercase">
          {tt('pricing.current', 'Current plan')}
        </span>
      )}

      <h3 className={`text-xl font-bold ${tc.text}`}>{plan.display_name}</h3>
      <p className={`mt-1 text-sm ${tc.textSecondary}`}>{plan.tagline}</p>

      <div className="mt-5 flex items-baseline gap-2">
        <span className={`text-4xl font-bold ${tc.text} tracking-tight`}>
          {plan.activation_fee_usd === 0
            ? tt('pricing.free', 'Free')
            : `$${(plan.activation_fee_usd / 100).toFixed(2)}`}
        </span>
        {plan.activation_fee_usd > 0 && (
          <span className={`text-sm ${tc.textMuted}`}>{tt('pricing.onetime', 'one-time')}</span>
        )}
      </div>

      <ul className="mt-6 space-y-2.5 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Check className={`w-4 h-4 mt-0.5 shrink-0 ${f.highlight ? 'text-[#C7FF00]' : tc.textMuted}`} />
            <span className={`text-sm ${f.highlight ? tc.text + ' font-medium' : tc.textSecondary}`}>{f.title}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-7">
        {isCurrent ? (
          <button disabled
                  className={`w-full inline-flex items-center justify-center px-4 py-3 rounded-full ${tc.bgAlt} ${tc.textMuted} text-sm font-semibold cursor-not-allowed`}>
            {tt('pricing.your_plan', 'Your plan')}
          </button>
        ) : canUpgrade ? (
          <button
            onClick={() => onUpgrade?.(plan.key)}
            className="w-full inline-flex items-center justify-center px-4 py-3 rounded-full bg-[#C7FF00] text-black text-sm font-semibold hover:opacity-90 transition"
          >
            {plan.cta_label}
          </button>
        ) : !signedIn ? (
          <button
            onClick={onSignUp}
            className={`w-full inline-flex items-center justify-center px-4 py-3 rounded-full ${plan.is_default ? `border ${tc.cardBorder} ${tc.text} ${tc.hoverBg}` : 'bg-[#C7FF00] text-black hover:opacity-90'} text-sm font-semibold transition`}
          >
            {plan.cta_label}
          </button>
        ) : (
          <button disabled
                  className={`w-full inline-flex items-center justify-center px-4 py-3 rounded-full ${tc.bgAlt} ${tc.textMuted} text-sm font-semibold cursor-not-allowed`}>
            {plan.is_default ? tt('pricing.included', 'Included') : plan.cta_label}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default PricingScreen;
