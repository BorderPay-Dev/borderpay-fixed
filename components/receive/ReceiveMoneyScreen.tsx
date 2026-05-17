/**
 * ReceiveMoneyScreen — Revolut-style composition over partner accounts.
 *
 * The previous version of this screen displayed *hardcoded* bank names
 * ("BorderPay Nigeria", "BorderPay Kenya" …) and a fake USD routing
 * number ("021000021"). A user copying any of that into a sender's
 * payment form would have wired money to nowhere. That entire block is
 * removed here.
 *
 * The Receive surface is now exactly what the partner has provisioned
 * for the user — no mock data:
 *   • USD / EUR / GBP virtual accounts → BridgeVirtualAccountsCard
 *     (reads bridge_virtual_accounts; offers Provision for currencies the
 *     user does not yet have, plan-gated server-side).
 *   • Stablecoin deposit addresses → BridgeWalletsCard
 *     (reads bridge_wallets; offers Provision for the default USDC/Base
 *     pair).
 *   • Local-currency rails are intentionally absent; they will surface
 *     once our on/off-ramp partner ships.
 *
 * AppShell owns the top chrome; this renders body-only.
 */

import React from 'react';
import { Shield, Inbox } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { useVerification } from '../../utils/verification/useVerification';
import { authAPI } from '../../utils/supabase/client';
import { BridgeVirtualAccountsCard } from '../dashboard/bridge/BridgeVirtualAccountsCard';
import { BridgeWalletsCard } from '../dashboard/bridge/BridgeWalletsCard';

interface ReceiveMoneyScreenProps {
  onBack: () => void;
  /** Kept for caller compatibility; the new screen always shows everything. */
  preSelectedWalletId?: string;
}

export function ReceiveMoneyScreen({ onBack }: ReceiveMoneyScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const storedUser = authAPI.getStoredUser() || {};
  const userId = (storedUser.id as string) || '';
  const verification = useVerification(userId);

  // KYC gate — partner approval is required before we can provision a USD
  // virtual account or a stablecoin wallet, so the Receive screen is
  // unusable pre-verification. Show a clear gate, not a blank canvas.
  if (!verification.isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <div className="max-w-2xl mx-auto px-5 pt-5 pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
            {tt('receive.title', 'Receive funds')}
          </p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
              Complete identity verification to open a USD account or
              stablecoin wallet that others can pay you on.
            </p>
            <button
              onClick={onBack}
              className={`text-[12px] font-semibold ${tc.textSecondary} hover:${tc.text}`}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {tt('receive.title', 'Receive funds')}
        </p>

        {/* Brief explainer so users know what these cards do */}
        <div className={`mb-5 rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-start gap-3`}>
          <Inbox className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>How others pay you</p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
              Use your USD account credentials for ACH/wire deposits, or
              share a stablecoin address for crypto transfers. Local-currency
              rails are launching with our partner integration.
            </p>
          </div>
        </div>

        {/* Virtual accounts (USD / EUR / GBP) */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('receive.virtualAccounts', 'Virtual accounts')}
        </h2>
        <div className="mb-6">
          <BridgeVirtualAccountsCard userId={userId} />
        </div>

        {/* Stablecoin deposit addresses */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('receive.stablecoins', 'Stablecoin addresses')}
        </h2>
        <div className="mb-6">
          <BridgeWalletsCard userId={userId} />
        </div>

        {/* Local rails — non-interactive Soon notice */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('receive.localRails', 'Local African rails')}
        </h2>
        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-center gap-3 opacity-70`}>
          <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
            <Inbox className={`w-4 h-4 ${tc.textMuted}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>NGN · KES · GHS · UGX · TZS · XAF · XOF</p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5`}>
              Local bank + mobile money inboxes — coming soon
            </p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/[0.06] text-white/60">Soon</span>
        </div>
      </div>
    </div>
  );
}

export default ReceiveMoneyScreen;
