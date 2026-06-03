/**
 * CardsLockedCard — locked product card visible on the dashboard.
 * Mirrors components/cards/CardsScreen.tsx (locked state).
 */

import React from 'react';
import { CreditCard, Lock } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';

export function CardsLockedCard() {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  return (
    <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6`}>
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-12 h-12 rounded-2xl bg-[#C7FF00]/30 flex items-center justify-center">
          <CreditCard className="w-6 h-6 text-black dark:text-white" />
        </div>
        <div className="flex-1">
          <h3 className={`text-base font-semibold ${tc.text} mb-1 flex items-center gap-2`}>
            {tt('cards.locked.title', 'Cards')}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${tc.bgAlt} ${tc.textMuted} border ${tc.border}`}>
              {tt('cards.locked.badge', 'Locked')}
            </span>
          </h3>
          <p className={`text-sm ${tc.textSecondary} mb-3`}>
            {tt('cards.locked.subtitle', 'Card issuing is not enabled for your account yet.')}
          </p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${tc.border} ${tc.textMuted} text-xs cursor-not-allowed opacity-60`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{tt('cards.locked.action', 'Card access locked')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default CardsLockedCard;
