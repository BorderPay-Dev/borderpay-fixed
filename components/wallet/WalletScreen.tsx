/**
 * WalletScreen — premium unified Balances + Deposit surface (poster-spec).
 *
 * One screen, two clean sections:
 *   • Total balance hero (USD-equivalent, hideable, glow card).
 *   • Balances list: every account + stablecoin in ONE list, brand flag/coin
 *     badge, currency name + sub-label (USD, EUR, USDT…), right-aligned big
 *     amount + token amount, chevron → tap opens the existing detail sheet
 *     (account "letter" for VA, deposit address for stablecoin).
 *   • Quick actions row (Send / Receive / Deposit / Convert).
 *   • Deposit chooser (USD-ACH / EUR-SEPA / GBP-FPS) for missing currencies.
 *
 * The old two-card stack (BridgeVirtualAccountsCard + BridgeWalletsCard) is
 * collapsed into one unified list to match the marketing posters and remove
 * the "where do I tap?" friction.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Shield, Eye, EyeOff, ArrowUpRight, ArrowDownLeft, Plus, RefreshCw,
  ChevronRight, Loader2,
} from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { isFullEnrollment, deriveKycStatus } from '../../utils/config/environment';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import {
  bridgeVirtualAccountCurrenciesForCountry,
  type BridgeVirtualAccountCurrency,
} from '../../utils/compliance/partnerCountryPolicy';
import { usePreferences } from '../../utils/hooks/usePreferences';
import {
  AssetBadge, WalletDetailSheet, AccountDetailSheet, chainLabel, assetName,
} from '../dashboard/bridge/WalletVisuals';
import { friendlyError } from '../../utils/errors/friendlyError';
import { showToast } from '../common/StatusToast';
import { SkeletonRows } from '../common/Skeleton';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface WalletScreenProps {
  userId:     string;
  onBack:     () => void;
  isVerified: boolean;
  onNavigate?: (screen: string) => void;
}

interface StableRow { id: string; currency: string; chain: string; address: string; status: string }
interface VaRow     { id: string; currency: BridgeVirtualAccountCurrency; rail: string | null; status: string; account_details: any; bridge_virtual_account_id: string }

const CURRENCY_FULL_NAME: Record<string, string> = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
};
const RAIL_NAME: Record<string, string> = { USD: 'ACH', EUR: 'SEPA', GBP: 'Faster Payments' };
const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

export function WalletScreen({ userId, onBack, isVerified: isVerifiedProp, onNavigate }: WalletScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const { prefs, updatePrefs } = usePreferences();
  const [balanceHidden, setBalanceHidden] = useState(prefs.hide_balance);

  // KYC gate — synchronous from cached profile.
  const [kycStatus] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) return deriveKycStatus(JSON.parse(stored));
    } catch { /* ignore */ }
    return 'pending';
  });
  const isVerified = isVerifiedProp || isFullEnrollment(kycStatus);

  const country = authAPI.getStoredUser()?.country ?? null;
  const availableVaCurrencies = useMemo(
    () => bridgeVirtualAccountCurrenciesForCountry(country),
    [country],
  );
  const stableWalletsCacheKey = useMemo(
    () => financialCacheKey('borderpay_wallets_v1', { userId }),
    [userId],
  );
  const vaCacheKey = useMemo(
    () => financialCacheKey('borderpay_va_v1', { userId }),
    [userId],
  );
  const walletRefreshTsKey = useMemo(
    () => financialCacheKey('borderpay_wallet_refresh_ts_v1', { userId }),
    [userId],
  );

  // ── Data ─────────────────────────────────────────────────────────────────
  const [stables, setStables] = useState<StableRow[]>(() => {
    try { return JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]'); } catch { return []; }
  });
  const [vas, setVas] = useState<VaRow[]>(() => {
    try { return JSON.parse(localStorage.getItem(vaCacheKey) || '[]'); } catch { return []; }
  });
  const hasCachedWalletRows = stables.length > 0 || vas.length > 0;
  const [totalUsd, setTotalUsd] = useState<number>(() => {
    try { const r = localStorage.getItem(`borderpay_wallet_total_${userId}`); return r ? Number(r) : 0; } catch { return 0; }
  });
  const [balanceByCurrency, setBalanceByCurrency] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`borderpay_wallet_balances_${userId}`) || '{}'); } catch { return {}; }
  });
  const [loading, setLoading] = useState(!hasCachedWalletRows);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const [selectedStable, setSelectedStable] = useState<StableRow | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);

  const shouldRunProviderSync = () => {
    try {
      const key = `borderpay_provider_sync_wallet:${userId}`;
      const now = Date.now();
      const last = Number(localStorage.getItem(key) || '0');
      if (Number.isFinite(last) && now - last < 5 * 60 * 1000) return false;
      localStorage.setItem(key, String(now));
      return true;
    } catch {
      return true;
    }
  };

  useEffect(() => {
    navPerfTrackCache('wallet-detail', stables.length > 0 || vas.length > 0);
  }, [stables.length, vas.length]);

  const refresh = async () => {
    const isColdStart = stables.length === 0 && vas.length === 0;
    if (isColdStart) setLoading(true);
    setRefreshing(true);
    try {
      const last = Number(localStorage.getItem(walletRefreshTsKey) || '0');
      if (!isColdStart && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const routeData: any = await backendAPI.financial.getWalletRouteData();
      const sList = (routeData?.data?.stablecoin_wallets as StableRow[]) ?? [];
      const vList = (routeData?.data?.virtual_accounts as VaRow[]) ?? [];
      setStables(sList);
      setVas(vList);
      try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(sList)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(vList)); } catch { /* noop */ }
      try { localStorage.setItem(walletRefreshTsKey, String(Date.now())); } catch { /* noop */ }

      const rows: any[] = Array.isArray(routeData?.data?.wallets) ? routeData.data.wallets : [];
      if (rows.length > 0) {
        const mapped = rows.reduce((acc: Record<string, number>, w: any) => {
          const c = String(w?.currency || '').toUpperCase();
          if (!c) return acc;
          acc[c] = Number(w?.balance || 0);
          return acc;
        }, {});
        setBalanceByCurrency(mapped);
        try { localStorage.setItem(`borderpay_wallet_balances_${userId}`, JSON.stringify(mapped)); } catch { /* noop */ }
        const tot = rows.reduce((s: number, w: any) => s + Number(w?.balance || 0), 0);
        setTotalUsd(tot);
        try { localStorage.setItem(`borderpay_wallet_total_${userId}`, String(tot)); } catch { /* noop */ }
      }
      // Provider provisioning/sync is background-only; never block first paint.
      if (shouldRunProviderSync()) {
        void Promise.allSettled([
          backendAPI.bridge.provisionStablecoins(),
          backendAPI.bridge.syncAccounts(),
        ]).then(async () => {
          try {
            const next: any = await backendAPI.financial.getWalletRouteData();
            const nextStables = (next?.data?.stablecoin_wallets as StableRow[]) ?? [];
            const nextVas = (next?.data?.virtual_accounts as VaRow[]) ?? [];
            setStables(nextStables);
            setVas(nextVas);
            try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(nextStables)); } catch { /* noop */ }
            try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVas)); } catch { /* noop */ }
            const nextRows: any[] = Array.isArray(next?.data?.wallets) ? next.data.wallets : [];
            if (nextRows.length > 0) {
              const mapped = nextRows.reduce((acc: Record<string, number>, w: any) => {
                const c = String(w?.currency || '').toUpperCase();
                if (!c) return acc;
                acc[c] = Number(w?.balance || 0);
                return acc;
              }, {});
              setBalanceByCurrency(mapped);
              try { localStorage.setItem(`borderpay_wallet_balances_${userId}`, JSON.stringify(mapped)); } catch { /* noop */ }
              const nextTot = nextRows.reduce((s: number, w: any) => s + Number(w?.balance || 0), 0);
              setTotalUsd(nextTot);
              try { localStorage.setItem(`borderpay_wallet_total_${userId}`, String(nextTot)); } catch { /* noop */ }
            }
          } catch {
            // keep first snapshot
          }
        });
      }
    } catch {
      // Keep cached data visible; refresh is best-effort.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { if (isVerified) refresh(); /* eslint-disable-next-line */ }, [userId, isVerified, walletRefreshTsKey]);

  // ── Missing VA currencies (the "deposit chooser") ────────────────────────
  const haveVa = useMemo(() => new Set(vas.map(v => v.currency)), [vas]);
  const missingVa = availableVaCurrencies.filter(c => !haveVa.has(c));

  const handleCreate = async (currency: BridgeVirtualAccountCurrency) => {
    setCreating(currency);
    const r = await backendAPI.bridge.virtualAccount.create({ currency });
    setCreating(null);
    if (!r.success) {
      showToast.error(friendlyError(r.error, `Could not open ${currency} account.`));
      return;
    }
    showToast.success(`${currency} account opened`);
    refresh();
  };

  // ── KYC gate ─────────────────────────────────────────────────────────────
  if (!isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <div className="max-w-2xl mx-auto px-5 pt-5 pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
            Accounts & wallets
          </p>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
              Complete identity verification to open accounts and stablecoin wallets.
            </p>
            <button onClick={() => onNavigate?.('kyc')}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#C7FF00] text-black font-bold text-sm active:scale-[0.98] transition">
              Start verification
            </button>
            <button onClick={onBack} className={`mt-3 text-[12px] font-semibold ${tc.textMuted} hover:${tc.text}`}>
              Back
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  const balances = totalUsd.toFixed(2).split('.');

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-28">

        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('wallet.title', 'Accounts & Wallets')}
          </p>
          <button onClick={refresh} aria-label="Refresh"
            className={`p-2 rounded-full ${tc.hoverBg} ${refreshing ? 'opacity-60' : ''}`}>
            <RefreshCw className={`w-4 h-4 ${tc.textMuted} ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

{/* Balance hero + quick actions live on the dashboard — the Wallet tab is
    a focused list of accounts + stablecoins, so we don't duplicate them here. */}

        {/* ── Balances list ──────────────────────────────────────────────── */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('wallet.balances', 'Balances')}
        </h2>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
          {loading ? (
            <div className="px-4 py-4">
              <SkeletonRows count={4} />
            </div>
          ) : vas.length === 0 && stables.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className={`text-sm ${tc.textMuted}`}>
                No accounts yet — open one below.
              </p>
            </div>
          ) : (
            <>
              {/* Fiat virtual accounts first */}
              {vas.map((v, i) => {
                const cur = String(v.currency).toUpperCase();
                const curBalance = Number(balanceByCurrency[cur] || 0);
                return (
                  <button key={v.id} onClick={() => setSelectedVa(v)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${i > 0 || stables.length > 0 ? `border-t ${tc.borderLight}` : ''}`}>
                    <AssetBadge symbol={cur} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] font-semibold ${tc.text} truncate`}>
                        {CURRENCY_FULL_NAME[cur] ?? cur} <span className={`text-xs font-medium ${tc.textMuted}`}>({RAIL_NAME[cur] ?? 'Bank transfer'})</span>
                      </div>
                      <div className={`text-[11px] ${tc.textMuted}`}>{cur} account</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[15px] font-bold ${tc.text}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {`${CURRENCY_SYMBOL[cur] || ''}${curBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${CURRENCY_SYMBOL[cur] ? '' : ` ${cur}`}`}
                      </div>
                      <div className={`text-[10px] ${tc.textMuted} uppercase tracking-wider`}>View details</div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}
              {/* Stablecoins */}
              {stables.map((s, i) => {
                const sym = String(s.currency || '').toUpperCase();
                const stableBalance = Number(balanceByCurrency[sym] || 0);
                const showDivider = vas.length > 0 || i > 0;
                return (
                  <button key={s.id} onClick={() => setSelectedStable({ ...s, currency: sym })}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${showDivider ? `border-t ${tc.borderLight}` : ''}`}>
                    <AssetBadge symbol={sym} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] font-semibold ${tc.text} truncate`}>
                        {sym} <span className={`text-xs font-medium ${tc.textMuted}`}>· {assetName(sym)} ({chainLabel(s.chain)})</span>
                      </div>
                      <div className={`text-[11px] ${tc.textMuted}`}>{sym} · stablecoin</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[15px] font-bold ${tc.text}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        ${stableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className={`text-[11px] ${tc.textMuted}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {stableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {sym}
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Missing-currency "+ open account" rows now live INLINE at the bottom
            of the Balances list (one row per currency), so the user has a single
            unified surface and we don't repeat the promo-card pattern. */}
        {missingVa.length > 0 && (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
            {missingVa.map((c, i) => (
              <button key={c} disabled={creating === c} onClick={() => handleCreate(c)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${i > 0 ? `border-t ${tc.borderLight}` : ''} disabled:opacity-60`}>
                <AssetBadge symbol={c} size={40} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[15px] font-semibold ${tc.text}`}>
                    Open {c} account <span className={`text-xs font-medium ${tc.textMuted}`}>({RAIL_NAME[c]})</span>
                  </div>
                  <div className={`text-[11px] ${tc.textMuted}`}>{CURRENCY_FULL_NAME[c] ?? c}</div>
                </div>
                {creating === c
                  ? <Loader2 className={`w-4 h-4 ${tc.textMuted} animate-spin`} />
                  : <ChevronRight className={`w-4 h-4 ${tc.textMuted}`} />}
              </button>
            ))}
          </div>
        )}

      </div>

      {/* Detail sheets */}
      <WalletDetailSheet open={!!selectedStable} onClose={() => setSelectedStable(null)}
        wallet={selectedStable ? { currency: selectedStable.currency, chain: selectedStable.chain, address: selectedStable.address } : null} />
      <AccountDetailSheet open={!!selectedVa} onClose={() => setSelectedVa(null)}
        va={selectedVa ? { currency: selectedVa.currency, rail: selectedVa.rail, status: selectedVa.status, account_details: selectedVa.account_details } : null} />
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick, tc }: { icon: any; label: string; onClick: () => void; tc: any }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] transition">
      <span className="w-9 h-9 rounded-full bg-[#C7FF00] flex items-center justify-center">
        <Icon className="w-4 h-4 text-black" />
      </span>
      <span className="text-[11px] font-semibold text-white/80">{label}</span>
    </button>
  );
}

export default WalletScreen;
