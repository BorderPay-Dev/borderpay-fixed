/**
 * FundingScreen — "Add money" entry point.
 *
 * Previously the `add-money` / `deposit` routes fell back to ReceiveMoneyScreen,
 * which is authored body-only (it assumes AppShell owns the top chrome). But the
 * funding routes are NOT top-level screens, so they render WITHOUT AppShell —
 * leaving no header/back control and letting the last section collide with the
 * phone's bottom browser chrome (the "hidden under footer" report).
 *
 * This screen is fully self-contained:
 *   • Owns its sticky header + Back control (works standalone).
 *   • Surfaces the two funding rails BorderPay has actually provisioned, each in
 *     its own clearly-titled section so neither is buried:
 *       – Virtual account (USD / EUR / GBP)  → BridgeVirtualAccountsCard
 *       – Stablecoin deposit addresses        → BridgeWalletsCard
 *   • Reserves generous safe-area-aware bottom padding so nothing is hidden
 *     under the floating footer or the mobile browser chrome.
 *   • KYC-gated: provisioning requires partner approval, so an unverified user
 *     sees a clear gate rather than empty cards.
 *
 * No card issuing here (that product stays locked); "virtual card" in product
 * shorthand = the USD/EUR/GBP virtual account shown below.
 */

import React from 'react';
import { ArrowLeft, Shield, Building2, Coins, Info } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { useVerification } from '../../utils/verification/useVerification';
import { authAPI } from '../../utils/supabase/client';
import { BridgeVirtualAccountsCard } from '../dashboard/bridge/BridgeVirtualAccountsCard';
import { BridgeWalletsCard } from '../dashboard/bridge/BridgeWalletsCard';

interface FundingScreenProps {
  onBack: () => void;
}

export function FundingScreen({ onBack }: FundingScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => {
    const v = (t as any)?.(k);
    return (typeof v === 'string' && v.trim() && v !== k) ? v : fb;
  };

  const storedUser = authAPI.getStoredUser() || {};
  const userId = (storedUser.id as string) || '';
  const verification = useVerification(userId);

  // Generous, safe-area-aware bottom padding so the last section is never
  // hidden under the floating footer / mobile browser chrome.
  const bottomPad = 'calc(env(safe-area-inset-bottom, 0px) + 7.5rem)';

  return (
    <div className={`min-h-[100dvh] ${tc.bg} ${tc.text}`}>
      {/* Self-contained sticky header with a real Back control. */}
      <div className={`sticky top-0 z-20 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 sm:px-5 py-3 pt-safe-header">
          <button
            type="button"
            onClick={onBack}
            aria-label={tt('common.back', 'Back')}
            className={`w-10 h-10 rounded-full ${tc.card} border ${tc.borderLight} flex items-center justify-center ${tc.hoverBg} transition-colors`}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold">{tt('funding.title', 'Add money')}</h1>
          <div className="w-10" />
        </div>
      </div>

      <div
        className="max-w-2xl mx-auto px-4 sm:px-5 pt-5"
        style={{ paddingBottom: bottomPad }}
      >
        {!verification.isVerified ? (
          /* KYC gate */
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center mt-2`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>
              {tt('funding.gate.title', 'Verification required')}
            </h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
              {tt('funding.gate.body', 'Complete identity verification to open a USD account or stablecoin wallet you can fund.')}
            </p>
            <button
              onClick={onBack}
              className={`text-[12px] font-semibold ${tc.textSecondary} hover:${tc.text}`}
            >
              {tt('common.back', 'Back')}
            </button>
          </div>
        ) : (
          <>
            {/* Explainer */}
            <div className={`mb-6 rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-start gap-3`}>
              <Info className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${tc.text}`}>
                  {tt('funding.explainer.title', 'Two ways to fund your account')}
                </p>
                <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
                  {tt('funding.explainer.body', 'Send a bank transfer to your virtual account, or deposit stablecoins to your wallet address.')}
                </p>
              </div>
            </div>

            {/* Section 1 — Virtual account (USD / EUR / GBP) */}
            <div className="mb-2.5 flex items-center gap-2 px-1">
              <Building2 className={`w-3.5 h-3.5 ${tc.textMuted}`} />
              <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
                {tt('funding.virtualAccount', 'Virtual account')}
              </h2>
            </div>
            <div className="mb-7">
              <BridgeVirtualAccountsCard userId={userId} />
            </div>

            {/* Section 2 — Stablecoin */}
            <div className="mb-2.5 flex items-center gap-2 px-1">
              <Coins className={`w-3.5 h-3.5 ${tc.textMuted}`} />
              <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
                {tt('funding.stablecoin', 'Stablecoin')}
              </h2>
            </div>
            <div>
              <BridgeWalletsCard userId={userId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default FundingScreen;
