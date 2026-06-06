/**
 * MoneyMovementGate (#5) — conditional layout switch for money-movement /
 * verification surfaces.
 *
 * Wrap any live-transaction or "start verification" surface with this. On a
 * paid plan it renders the children unchanged; on a Free plan it renders an
 * upgrade prompt instead and routes to the existing upgrade flow. This is the
 * frontend half of the paywall — the authoritative enforcement is server-side
 * in the bridge-* edge functions (payment_required) and bridge-transfer.
 *
 * Usage:
 *   <MoneyMovementGate planKey={planKey} onUpgrade={onUpgrade}>
 *     <SendMoneyFlow ... />
 *   </MoneyMovementGate>
 */

import React from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { canMoveMoney } from '../../utils/subscriptions/gate';

interface MoneyMovementGateProps {
  planKey:    string | null | undefined;
  onUpgrade:  () => void;
  /** Short label for what's gated, e.g. "Sending money". */
  feature?:   string;
  children:   React.ReactNode;
}

export function MoneyMovementGate({ planKey, onUpgrade, feature = 'This feature', children }: MoneyMovementGateProps) {
  const tc = useThemeClasses();

  if (canMoveMoney(planKey)) return <>{children}</>;

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-md mx-auto px-5 pt-10 pb-10">
        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
          <div className="w-14 h-14 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-[#C7FF00]" />
          </div>
          <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Upgrade to unlock</h2>
          <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
            {feature} is available on the Premium plan. Free accounts are view-only —
            upgrade to move money and complete identity verification.
          </p>
          <button
            onClick={onUpgrade}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#C7FF00] text-black font-bold text-sm active:scale-[0.98] transition"
          >
            <Sparkles className="w-4 h-4" />
            Upgrade to Premium
          </button>
        </div>
      </div>
    </div>
  );
}

export default MoneyMovementGate;
