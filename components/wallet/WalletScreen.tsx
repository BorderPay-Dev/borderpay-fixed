/**
 * WalletScreen — Revolut-style composition of Bridge cards.
 *
 * Previously this screen displayed *hardcoded* USD account credentials
 * (account number, routing number, "Lead Bank") that were not tied to
 * any real backend row — users would have copied those credentials and
 * tried to wire money to an account that doesn't exist. That block has
 * been removed; the real Bridge surface lives in `bridge_virtual_accounts`
 * and is rendered via <BridgeVirtualAccountsCard/>.
 *
 * Composition:
 *   1. Total balance header (USD-equivalent across USD VA + stablecoins)
 *   2. <BridgeVirtualAccountsCard/> — USD / EUR / GBP virtual accounts.
 *      Plan-gated server-side: EUR/GBP return 402 on the Starter plan,
 *      which triggers the global UpgradeModal.
 *   3. <BridgeWalletsCard/> — Custodial stablecoin wallets (USDC/USDT/
 *      PYUSD/USDB) on Base/Ethereum/Solana/Optimism/Polygon.
 *   4. <CardsComingSoonCard/> — Cards are not yet issued.
 *   5. <AfricanRailsFutureCard/> — Local-currency rails are future-state
 *      (Yativo integration). NGN/KES/GHS/UGX/etc. show "Coming soon".
 *
 * AppShell owns the top chrome for top-level routes, so this screen
 * renders body-only.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Eye, EyeOff } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { isFullEnrollment, deriveKycStatus } from '../../utils/config/environment';
import { supabase } from '../../utils/supabase/client';
import { BridgeVirtualAccountsCard } from '../dashboard/bridge/BridgeVirtualAccountsCard';
import { BridgeWalletsCard } from '../dashboard/bridge/BridgeWalletsCard';
import { CardsComingSoonCard } from '../dashboard/bridge/CardsComingSoonCard';
import { AfricanRailsFutureCard } from '../dashboard/bridge/AfricanRailsFutureCard';
import { usePreferences } from '../../utils/hooks/usePreferences';

interface WalletScreenProps {
  userId:     string;
  onBack:     () => void;
  isVerified: boolean;
  onNavigate?: (screen: string) => void;
}

export function WalletScreen({ userId, onBack, onNavigate }: WalletScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  // KYC gate — synchronous read from cached profile so we don't flash the
  // wallet content for unverified users before deciding to show the gate.
  const [kycStatus] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) return deriveKycStatus(JSON.parse(stored));   // Bridge-first
    } catch { /* ignore */ }
    return 'pending';
  });

  const { prefs, updatePrefs } = usePreferences();
  const [balanceHidden, setBalanceHidden] = useState(prefs.hide_balance);

  // Total balance: sum of available_balance_minor on USD VA + stablecoin
  // wallets is the right source-of-truth post-Bridge. The legacy `wallets`
  // table is no longer consulted here — that was the source of the fake
  // hardcoded USD account in the old WalletScreen.
  const [totalUsd, setTotalUsd]   = useState<number>(0);
  const [loading, setLoading]     = useState<boolean>(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('bridge_virtual_account_balances')
          .select('available_balance_minor, currency')
          .eq('user_id', userId);
        if (!alive) return;
        if (!error && Array.isArray(data)) {
          // For v1 we count USD VA balance only; EUR/GBP totals will land
          // when we add FX-aware conversion (planned for Day 8+).
          const usdMinor = data
            .filter((r: any) => r.currency === 'USD')
            .reduce((s: number, r: any) => s + Number(r.available_balance_minor || 0), 0);
          setTotalUsd(usdMinor / 100);
        }
      } catch { /* non-fatal */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [userId]);

  const isVerified = useMemo(() => isFullEnrollment(kycStatus), [kycStatus]);

  // ─── KYC gate (overlay) ──────────────────────────────────────────────
  // Bridge requires verified state for virtual accounts and transfers, so
  // the wallet screen is unusable pre-KYC. Surface the gate clearly.
  if (!isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <div className="max-w-2xl mx-auto px-5 pt-5 pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
            Accounts & wallets
          </p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
              Complete identity verification to open virtual accounts and stablecoin wallets.
            </p>
            <button
              onClick={() => onNavigate?.('kyc')}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#C7FF00] text-black font-bold text-sm active:scale-[0.98] transition"
            >
              Start verification
            </button>
            <button
              onClick={onBack}
              className={`mt-3 text-[12px] font-semibold ${tc.textMuted} hover:${tc.text}`}
            >
              Back
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          Accounts & wallets
        </p>

        {/* ── Total balance hero ─────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] px-5 py-5 mb-5">
          <div className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-[#C7FF00] opacity-[0.06] blur-3xl" />
          <p className="relative text-[10px] uppercase tracking-[0.18em] font-semibold text-white/40 mb-1.5">
            {tt('wallet.totalBalance', 'Total balance (USD)')}
          </p>
          <div className="relative flex items-end gap-2">
            <h1 className="text-white font-semibold tracking-tight tabular-nums leading-none text-[36px] sm:text-[44px]">
              {balanceHidden ? (
                <span>••••••</span>
              ) : loading ? (
                <span className="text-white/40">$ —.—</span>
              ) : (
                <>
                  <span className="text-xl sm:text-2xl text-white/50 mr-1 align-top">$</span>
                  {totalUsd.toFixed(2).split('.')[0]}
                  <span className="text-xl sm:text-2xl text-white/50">
                    .{totalUsd.toFixed(2).split('.')[1]}
                  </span>
                </>
              )}
            </h1>
            <button
              onClick={() => { const n = !balanceHidden; setBalanceHidden(n); updatePrefs({ hide_balance: n }); }}
              aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
              className="ml-1 mb-1 p-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
            >
              {balanceHidden
                ? <Eye className="w-4 h-4 text-white/50" />
                : <EyeOff className="w-4 h-4 text-white/50" />}
            </button>
          </div>
          <p className="relative text-[11px] text-white/40 mt-1.5">
            {tt('wallet.totalSub', 'USD virtual account balance only. Multi-currency totals coming with FX support.')}
          </p>
        </div>

        {/* ── Section: Virtual accounts ─────────────────────────────── */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('wallet.virtualAccounts', 'Virtual accounts')}
        </h2>
        <div className="mb-6">
          <BridgeVirtualAccountsCard userId={userId} />
        </div>

        {/* ── Section: Stablecoin wallets ───────────────────────────── */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('wallet.stablecoins', 'Stablecoin wallets')}
        </h2>
        <div className="mb-6">
          <BridgeWalletsCard userId={userId} />
        </div>

        {/* ── Section: Cards (Coming Soon) ──────────────────────────── */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('wallet.cards', 'Cards')}
        </h2>
        <div className="mb-6">
          <CardsComingSoonCard />
        </div>

        {/* ── Section: African rails (future) ───────────────────────── */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('wallet.localRails', 'Local African rails')}
        </h2>
        <AfricanRailsFutureCard />
      </div>
    </div>
  );
}

export default WalletScreen;
