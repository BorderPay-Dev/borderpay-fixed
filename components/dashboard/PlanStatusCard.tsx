/**
 * PlanStatusCard — Wise-style activation prompt for the signed-in dashboard.
 *
 * Behaviour (individual + business):
 *   • While the account is NOT activated yet, this shows a single, friendly
 *     "Fund your wallet" card whose CTA opens the Fund Wallet sheet
 *     (verify ID → unlock multi-currency accounts + wallet).
 *   • Once the account IS activated, the card renders NOTHING and disappears
 *     entirely — exactly like the setup checklist vanishes at 4/4. There is no
 *     persistent "Starter" tier and nothing to "manage" on a one-time fee.
 *
 * Provider neutrality: this card knows nothing about Bridge. The activation /
 * wallet-debit flow lives entirely in UpgradeModal + subscription-upgrade.
 */

import React from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { getPlan, type PlanKey, type AccountType } from '../../utils/subscriptions/plans';

export interface PlanStatusCardProps {
  /** The user's active plan_key. null while loading. */
  planKey:        PlanKey | null;
  accountType:    AccountType;
  /** Kept for API compatibility; no longer used (no "manage" on a one-time fee). */
  userId:         string;
  /** Opens /pricing (PricingScreen) inside the app shell — fallback CTA target. */
  onManagePlans:  () => void;
  /** Opens the activation flow (UpgradeModal) for the appropriate tier. */
  onUpgrade?:     () => void;
}

export function PlanStatusCard({
  planKey, accountType, onManagePlans, onUpgrade,
}: PlanStatusCardProps) {
  const tc = useThemeClasses();

  // Loading skeleton until the parent's subscription fetch resolves.
  if (!planKey) {
    return (
      <div className={`rounded-2xl ${tc.card} border ${tc.cardBorder} px-4 py-4 flex items-center gap-3`}>
        <div className={`w-9 h-9 rounded-full ${tc.bgAlt} animate-pulse`} />
        <div className="flex-1 space-y-1.5">
          <div className={`h-3 w-24 rounded ${tc.bgAlt} animate-pulse`} />
          <div className={`h-2.5 w-32 rounded ${tc.bgAlt} animate-pulse`} />
        </div>
      </div>
    );
  }

  // Activated → the card disappears. Nothing to show, nothing to manage.
  if (getPlan(planKey).is_activated) return null;

  const onActivate = onUpgrade ?? onManagePlans;
  const isBusiness = accountType === 'business';

  return (
    <div className={`rounded-2xl border px-4 py-4 ${tc.card} ${tc.cardBorder}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-[#C7FF00]/15">
          <Sparkles className="w-4 h-4 text-[#C7FF00]" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold ${tc.text}`}>
            {isBusiness ? 'Receive first funds to unlock business accounts' : 'Receive first funds to unlock your accounts'}
          </h3>
          <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
            {isBusiness
              ? 'Receive your first transfer or deposit at least $50 in USDC/USDT to unlock USD, EUR & GBP accounts automatically.'
              : 'Receive your first transfer or deposit at least $20 in USDC/USDT to unlock USD, EUR & GBP accounts automatically.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onActivate}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#C7FF00] text-black text-[11px] font-bold flex-shrink-0 hover:brightness-95 transition"
        >
          Get started
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default PlanStatusCard;
