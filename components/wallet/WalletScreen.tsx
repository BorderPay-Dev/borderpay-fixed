/**
 * WalletScreen — premium unified Balances + Deposit surface (poster-spec).
 *
 * One screen, two clean sections:
 *   • Total balance hero (USD-equivalent, hideable, glow card).
 *   • Balances list: every account + stablecoin in ONE list, brand flag/coin
 *     badge, currency name + sub-label (USD, EUR, USDT…), right-aligned big
 *     amount + token amount, chevron → tap opens the existing detail sheet
 *     (account "letter" for VA, deposit address for stablecoin).
 *   • Wallet tab shows active accounts only; AddWallet owns inactive and
 *     unavailable account requests.
 *
 * The old two-card stack (BridgeVirtualAccountsCard + BridgeWalletsCard) is
 * collapsed into one unified list to match the marketing posters and remove
 * the "where do I tap?" friction.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Shield, Eye, EyeOff, RefreshCw, ChevronRight,
} from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { isFullEnrollment, deriveKycStatus } from '../../utils/config/environment';
import { backendAPI } from '../../utils/api/backendAPI';
import {
  bridgeVirtualAccountCurrenciesForCountry,
  type BridgeVirtualAccountCurrency,
} from '../../utils/compliance/partnerCountryPolicy';
import { usePreferences } from '../../utils/hooks/usePreferences';
import {
  AssetBadge, WalletDetailSheet, AccountDetailSheet, chainLabel, assetName,
} from '../dashboard/bridge/WalletVisuals';
import { SkeletonRows } from '../common/Skeleton';
import { FloatingBackButton } from '../common/FloatingBackButton';
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
const SUPPORTED_STABLES = new Set(['USDC', 'USDT']);
const SUPPORTED_VA = new Set(['USD', 'EUR', 'GBP']);
const ACTIVE_WALLET_STATUSES = new Set(['active', 'approved', 'enabled', 'ready', 'provisioned']);
const ACTIVE_VA_STATUSES = new Set(['active', 'approved', 'enabled', 'ready', 'provisioned']);

function normalizedStatus(row: any): string {
  return String(row?.status || row?.state || '').trim().toLowerCase();
}

function latestByCurrency<T extends { currency?: string }>(rows: T[]): T[] {
  const byCurrency = new Map<string, T>();
  rows.forEach((row) => {
    const currency = String(row.currency || '').toUpperCase();
    if (!currency) return;
    const existing = byCurrency.get(currency) as any;
    const current = row as any;
    const existingTs = Date.parse(String(existing?.updated_at || existing?.created_at || '')) || 0;
    const currentTs = Date.parse(String(current?.updated_at || current?.created_at || '')) || 0;
    if (!existing || currentTs >= existingTs) byCurrency.set(currency, row);
  });
  return Array.from(byCurrency.values());
}

function normalizeStableRows(raw: unknown): StableRow[] {
  if (!Array.isArray(raw)) return [];
  return latestByCurrency(
    raw
      .map((row: any) => ({
        ...row,
        currency: String(row?.currency || '').toUpperCase(),
      }))
      .filter((row: any) => SUPPORTED_STABLES.has(row.currency))
      .filter((row: any) => ACTIVE_WALLET_STATUSES.has(normalizedStatus(row))),
  ) as StableRow[];
}

function normalizeVaRows(raw: unknown, country: string | null | undefined): VaRow[] {
  if (!Array.isArray(raw)) return [];
  const countryAllowed = bridgeVirtualAccountCurrenciesForCountry(country);
  return latestByCurrency(
    raw
      .map((row: any) => ({
        ...row,
        currency: String(row?.currency || '').toUpperCase() as BridgeVirtualAccountCurrency,
      }))
      .filter((row: any) => SUPPORTED_VA.has(row.currency))
      .filter((row: any) => countryAllowed.includes(row.currency))
      .filter((row: any) => ACTIVE_VA_STATUSES.has(normalizedStatus(row))),
  ) as VaRow[];
}

function readCachedCountry(): string | null {
  try {
    const stored = localStorage.getItem('borderpay_user');
    if (!stored) return null;
    const profile = JSON.parse(stored);
    return profile?.country ? String(profile.country).toUpperCase() : null;
  } catch {
    return null;
  }
}

function intersectVaCapabilities(
  supported: unknown,
  country: string | null | undefined,
): BridgeVirtualAccountCurrency[] {
  const countryAllowed = bridgeVirtualAccountCurrenciesForCountry(country);
  if (!Array.isArray(supported)) return countryAllowed;
  const globalSupported = supported
    .map((c: unknown) => String(c || '').toUpperCase())
    .filter((c: string): c is BridgeVirtualAccountCurrency => ['USD', 'EUR', 'GBP'].includes(c));
  return countryAllowed.filter((c) => globalSupported.includes(c));
}

export function WalletScreen({ userId, onBack, isVerified: isVerifiedProp, onNavigate }: WalletScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const snapshotReader = backendAPI.financial.getSnapshot;
  void snapshotReader;
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const { prefs, updatePrefs } = usePreferences();
  const [balanceHidden, setBalanceHidden] = useState(prefs.hide_balance);

  // KYC gate — synchronous from cached profile.
  const [kycStatus, setKycStatus] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) return deriveKycStatus(JSON.parse(stored));
    } catch { /* ignore */ }
    return 'pending';
  });
  const isVerified = isVerifiedProp || isFullEnrollment(kycStatus);

  const [country, setCountry] = useState<string | null>(() => readCachedCountry());
  const [availableVaCurrencies, setAvailableVaCurrencies] = useState<BridgeVirtualAccountCurrency[]>(
    () => bridgeVirtualAccountCurrenciesForCountry(readCachedCountry()),
  );
  const stableWalletsCacheKey = useMemo(
    () => financialCacheKey('borderpay_wallets_v1', { userId }),
    [userId],
  );
  const vaCacheKey = useMemo(
    () => financialCacheKey('borderpay_va_v1', { userId }),
    [userId],
  );
  useEffect(() => {
    const hasStable = (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
        return Array.isArray(scoped) && scoped.length > 0;
      } catch { return false; }
    })();
    const hasVa = (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
        return Array.isArray(scoped) && scoped.length > 0;
      } catch { return false; }
    })();
    navPerfTrackCache('wallet-detail', hasStable || hasVa);
  }, [stableWalletsCacheKey, vaCacheKey]);
  const walletRefreshTsKey = useMemo(
    () => financialCacheKey('borderpay_wallet_refresh_ts_v1', { userId }),
    [userId],
  );

  // ── Data ─────────────────────────────────────────────────────────────────
  const [stables, setStables] = useState<StableRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
      return normalizeStableRows(scoped);
    } catch { return []; }
  });
  const [vas, setVas] = useState<VaRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
      return normalizeVaRows(scoped, readCachedCountry());
    } catch { return []; }
  });
  const stablesRef = useRef<StableRow[]>(stables);
  const vasRef = useRef<VaRow[]>(vas);
  const hasCachedWalletRows = stables.length > 0 || vas.length > 0;
  const [totalUsd, setTotalUsd] = useState<number>(() => {
    try { const r = localStorage.getItem(`borderpay_wallet_total_${userId}`); return r ? Number(r) : 0; } catch { return 0; }
  });
  const [balanceByCurrency, setBalanceByCurrency] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`borderpay_wallet_balances_${userId}`) || '{}'); } catch { return {}; }
  });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedStable, setSelectedStable] = useState<StableRow | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const refreshInFlightRef = useRef(false);
  const preselectConsumedRef = useRef(false);

  useEffect(() => { stablesRef.current = stables; }, [stables]);
  useEffect(() => { vasRef.current = vas; }, [vas]);

  useEffect(() => {
    if (preselectConsumedRef.current) return;
    let requested = '';
    try { requested = String(sessionStorage.getItem('borderpay_open_wallet_currency') || '').toUpperCase(); } catch { requested = ''; }
    if (!requested) return;

    const countryAllowed = bridgeVirtualAccountCurrenciesForCountry(country);
    const va = vas.find((row) => {
      const currency = String(row.currency || '').toUpperCase() as BridgeVirtualAccountCurrency;
      return currency === requested && countryAllowed.includes(currency);
    });
    if (va) {
      setSelectedVa(va);
      preselectConsumedRef.current = true;
      try { sessionStorage.removeItem('borderpay_open_wallet_currency'); } catch { /* noop */ }
      return;
    }
    const stable = stables.find((row) => String(row.currency || '').toUpperCase() === requested);
    if (stable) {
      setSelectedStable(stable);
      preselectConsumedRef.current = true;
      try { sessionStorage.removeItem('borderpay_open_wallet_currency'); } catch { /* noop */ }
      return;
    }
    if (!loading && !refreshing) {
      preselectConsumedRef.current = true;
      try { sessionStorage.removeItem('borderpay_open_wallet_currency'); } catch { /* noop */ }
    }
  }, [vas, stables, loading, refreshing, country]);

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

  const refresh = async (force = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const seededStables = stablesRef.current.length > 0 ? stablesRef.current : (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
        return normalizeStableRows(scoped);
      } catch { return []; }
    })();
    const seededVas = vasRef.current.length > 0 ? vasRef.current : (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
        return normalizeVaRows(scoped, country);
      } catch { return []; }
    })();
    const isColdStart = seededStables.length === 0 && seededVas.length === 0;
    setRefreshing(true);
    try {
      const last = Number(localStorage.getItem(walletRefreshTsKey) || '0');
      if (!force && !isColdStart && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const routeData: any = await backendAPI.financial.getWalletRouteData();
      const rawStables = Array.isArray(routeData?.data?.stablecoin_wallets) ? routeData.data.stablecoin_wallets : [];
      const rawVas = Array.isArray(routeData?.data?.virtual_accounts) ? routeData.data.virtual_accounts : [];
      const sList = normalizeStableRows(rawStables);
      const vList = normalizeVaRows(rawVas, country);
      setStables(sList);
      setVas(vList);
      try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(rawStables)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(rawVas)); } catch { /* noop */ }
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
          backendAPI.bridge.syncAccounts(),
        ]).then(async () => {
          try {
            const next: any = await backendAPI.financial.getWalletRouteData();
            const rawNextStables = Array.isArray(next?.data?.stablecoin_wallets) ? next.data.stablecoin_wallets : [];
            const rawNextVas = Array.isArray(next?.data?.virtual_accounts) ? next.data.virtual_accounts : [];
            const nextStables = normalizeStableRows(rawNextStables);
            const nextVas = normalizeVaRows(rawNextVas, country);
            setStables(nextStables);
            setVas(nextVas);
            try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(rawNextStables)); } catch { /* noop */ }
            try { localStorage.setItem(vaCacheKey, JSON.stringify(rawNextVas)); } catch { /* noop */ }
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
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      let profileCountry = country;
      try {
        const profile = await backendAPI.user.getProfile();
        if (alive && profile?.success && profile?.data?.user) {
          const nextCountry = profile.data.user?.country ? String(profile.data.user.country).toUpperCase() : null;
          profileCountry = nextCountry;
          setCountry(nextCountry);
          setKycStatus(deriveKycStatus(profile.data.user));
          try { localStorage.setItem('borderpay_user', JSON.stringify(profile.data.user)); } catch { /* noop */ }
        }
      } catch {
        // Keep cached country policy.
      }
      try {
        const caps = await backendAPI.bridge.virtualAccount.capabilities();
        if (!alive) return;
        if (caps?.success) {
          setAvailableVaCurrencies(intersectVaCapabilities(caps.data?.supported_currencies, profileCountry));
        } else {
          setAvailableVaCurrencies(bridgeVirtualAccountCurrenciesForCountry(profileCountry));
        }
      } catch {
        if (alive) setAvailableVaCurrencies(bridgeVirtualAccountCurrenciesForCountry(profileCountry));
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    const prewarmKey = `borderpay_wallet_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['receive-money', 'send-money', 'transactions', 'exchange', 'external-wallets', 'external-accounts'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 1000 });
          else setTimeout(warm, 120);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }

    if (isVerified) refresh();
    const onFocus = () => { if (isVerified) void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isVerified) void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  /* eslint-disable-next-line */ }, [userId, isVerified, walletRefreshTsKey]);

  const visibleVas = useMemo(() => {
    return normalizeVaRows(vas, country);
  }, [vas, country]);
  void availableVaCurrencies;

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
      <FloatingBackButton onBack={onBack} label="Return to main app" />
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-floating-back pb-28">

        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('wallet.title', 'Accounts & Wallets')}
          </p>
          <button onClick={() => refresh(true)} aria-label="Refresh"
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
          ) : visibleVas.length === 0 && stables.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className={`text-sm ${tc.textMuted}`}>
                No active accounts or wallets yet.
              </p>
            </div>
          ) : (
            <>
              {/* Fiat virtual accounts first */}
              {visibleVas.map((v, i) => {
                const cur = String(v.currency).toUpperCase();
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
                    <div className={`text-right text-[10px] ${tc.textMuted} uppercase tracking-wider`}>
                      View details
                    </div>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}
              {/* Stablecoins */}
              {stables.map((s, i) => {
                const sym = String(s.currency || '').toUpperCase();
                const stableBalance = Number(balanceByCurrency[sym] || 0);
                const showDivider = visibleVas.length > 0 || i > 0;
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

      </div>

      {/* Detail sheets */}
      <WalletDetailSheet open={!!selectedStable} onClose={() => setSelectedStable(null)}
        wallet={selectedStable ? { currency: selectedStable.currency, chain: selectedStable.chain, address: selectedStable.address } : null} />
      <AccountDetailSheet open={!!selectedVa} onClose={() => setSelectedVa(null)}
        va={selectedVa ? { currency: selectedVa.currency, rail: selectedVa.rail, status: selectedVa.status, account_details: selectedVa.account_details } : null} />
    </div>
  );
}

export default WalletScreen;
