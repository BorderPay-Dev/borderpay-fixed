/**
 * BorderPay Africa — Cards (locked)
 *
 * Card issuing is not enabled for this product yet. Keep a real locked
 * product boundary, but do not show preview card faces or active card controls.
 *
 * Header chrome (back / title) is owned by AppShell for top-level routes —
 * this screen renders body-only.
 */

import React from 'react';
import { CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface CardsScreenProps {
  onBack: () => void;
}

export function CardsScreen({ onBack: _onBack }: CardsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  const title       = (t as any)?.('cards.locked.title')    ?? 'Cards are locked';
  const subtitle    = (t as any)?.('cards.locked.subtitle') ?? 'Card issuing is not enabled for your account yet.';
  const sectionTitle = 'Cards';

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        {/* Section eyebrow (replaces the old duplicate top bar) */}
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {sectionTitle}
        </p>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6 max-w-2xl`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-6 h-6 text-[#C7FF00]" />
            </div>
            <div className="min-w-0">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${tc.borderLight} ${tc.bgAlt} mb-3`}>
                <Lock className={`w-3 h-3 ${tc.textMuted}`} />
                <span className={`text-[10px] font-bold tracking-wider uppercase ${tc.textMuted}`}>Locked</span>
              </div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
                {title}
              </h1>
              <p className={`text-sm ${tc.textMuted} leading-relaxed`}>
                {subtitle}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-7 max-w-md">
          <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
            No card can be issued yet
          </h1>
          <p className={`text-sm ${tc.textMuted} leading-relaxed`}>
            The card backend stays locked until BorderPay has live card access.
            This screen will connect to the card service once that access is
            approved; until then it cannot create, fund, freeze, or manage cards.
          </p>

          <button
            type="button"
            disabled
            aria-disabled="true"
            className={`mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full border ${tc.cardBorder} ${tc.textMuted} cursor-not-allowed`}
          >
            <Lock className="w-4 h-4" />
            <span className="text-sm font-medium">Card access locked</span>
          </button>

          <ul className={`mt-8 space-y-2.5 text-sm ${tc.textSecondary}`}>
            <li className="flex items-start gap-2">
              <Lock className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>No cards can be created or managed yet.</span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Card access will stay off until the backend is approved and enabled.</span>
            </li>
            <li className="flex items-start gap-2">
              <Lock className="w-4 h-4 mt-0.5 text-[#C7FF00] flex-shrink-0" />
              <span>Existing money features remain separate from card issuing.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default CardsScreen;
