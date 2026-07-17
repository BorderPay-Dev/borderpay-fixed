/**
 * BusinessDashboard — minimal MVP for business accounts.
 *
 * Reuses the existing wallet + send + receive flows. The only business-
 * specific surface here is the header (company name + reg number) and a
 * compact CTA grid that hands off to the same SendMoneyFlow / ReceiveMoneyScreen
 * /TransactionsScreen the individual dashboard uses.
 *
 * Existing individual `Dashboard` is untouched.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Send, Download, RefreshCw, Loader2, Wallet, CreditCard, Plus,
  AlertCircle, ShieldCheck, ShieldAlert, Users, Banknote, ArrowRight, ArrowRightLeft, BriefcaseBusiness, FileText,
} from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { deriveKycStatus } from '../../utils/config/environment';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { BridgeKycStatusCard } from '../dashboard/bridge/BridgeKycStatusCard';
import { CardsLockedCard } from '../dashboard/bridge/CardsLockedCard';
import { TreasuryCard } from './TreasuryCard';
import { ExchangeRateWidget } from '../dashboard/fx/ExchangeRateWidget';
import { AffiliateBanner } from '../referral/AffiliateBanner';
import { friendlyError } from '../../utils/errors/friendlyError';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { FX_NAV_ENABLED, PAYROLL_RUNTIME_ENABLED } from '../../utils/featureFlags';
import { SecurityStatus, TOTPManager } from '../../utils/security/SecurityManager';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';
import { AccountDetailSheet } from '../dashboard/bridge/WalletVisuals';
import { bridgeVirtualAccountCurrenciesForCountry } from '../../utils/compliance/partnerCountryPolicy';

const BIZ_WALLETS_KEY = 'borderpay_business_dash_wallets_v1';
const BIZ_TX_KEY = 'borderpay_business_dash_tx_v1';
const BIZ_NAME_KEY_PREFIX = 'borderpay_business_name_v1:';
const BIZ_DASH_REFRESH_TS_KEY = 'borderpay_business_dash_refresh_ts_v1';
const VA_LIST_CACHE_KEY = 'borderpay_va_v1';
const BIZ_DASH_VA_KEY = 'borderpay_business_dash_va_v1';
const ACTIVE_BIZ_VA_STATUSES = new Set(['active', 'approved', 'enabled', 'ready', 'provisioned']);

type BusinessVaRow = {
  id: string;
  currency: string;
  rail?: string | null;
  status?: string;
  account_details: any;
  bridge_virtual_account_id?: string;
  created_at?: string;
  updated_at?: string;
};

function normalizeBusinessVaRows(raw: unknown, country: string | null | undefined): BusinessVaRow[] {
  if (!Array.isArray(raw)) return [];
  const allowed = bridgeVirtualAccountCurrenciesForCountry(country);
  const byCurrency = new Map<string, BusinessVaRow>();
  raw.forEach((row: any) => {
    const currency = String(row?.currency || '').toUpperCase();
    const status = String(row?.status || '').trim().toLowerCase();
    if (!allowed.includes(currency as any)) return;
    if (!ACTIVE_BIZ_VA_STATUSES.has(status)) return;
    const next: BusinessVaRow = {
      ...row,
      id: String(row?.id || row?.bridge_virtual_account_id || `va:${currency}`),
      currency,
      rail: row?.rail ?? row?.payment_rail ?? null,
      account_details: row?.account_details || {},
    };
    const existing = byCurrency.get(currency);
    const existingTs = Date.parse(String(existing?.updated_at || existing?.created_at || '')) || 0;
    const nextTs = Date.parse(String(next.updated_at || next.created_at || '')) || 0;
    if (!existing || nextTs >= existingTs) byCurrency.set(currency, next);
  });
  return Array.from(byCurrency.values());
}

function readBizWallets(cacheKey: string): WalletRow[] {
  try { const raw = localStorage.getItem(cacheKey); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function readBizTx(cacheKey: string): any[] {
  try { const raw = localStorage.getItem(cacheKey); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function hasActiveCachedVa(userId: string): boolean {
  try {
    const raw = localStorage.getItem(financialCacheKey(VA_LIST_CACHE_KEY, { userId }));
    const rows = raw ? JSON.parse(raw) : [];
    return normalizeBusinessVaRows(rows, authAPI.getStoredUser()?.country).length > 0;
  } catch {
    return false;
  }
}

interface BusinessDashboardProps {
  userId:    string;
  onLogout:  () => void;
  onNavigate: (screen: string) => void;
}

interface WalletRow {
  currency: string;
  balance:  number;
}

const CURRENCY_LABEL: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  USDT: 'Tether USD',
  USDC: 'USD Coin',
};
const CURRENCY_COLOR: Record<string, string> = {
  USD: '#60A5FA',
  EUR: '#A78BFA',
  GBP: '#34D399',
  USDT: '#26A17B',
  USDC: '#2775CA',
};
const STABLE_ICON_URL: Record<string, string> = {
  USDC: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=040',
  USDT: 'https://cryptologos.cc/logos/tether-usdt-logo.png?v=040',
};

function isSpendableBusinessWallet(row: { balance?: number }): boolean {
  const balance = Number(row?.balance || 0);
  return Number.isFinite(balance) && balance > 0;
}

function formatBusinessWalletBalance(row: { currency: string; balance: number }): string {
  const code = String(row.currency || '').toUpperCase();
  const symbol = code === 'EUR' ? '€' : code === 'GBP' ? '£' : code === 'USDT' ? '₮' : '$';
  const formatted = Number(row.balance || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function prefetchScreen(screen: string): void {
  try { (window as any).__borderpay_prefetch?.(screen); } catch { /* noop */ }
}

export function BusinessDashboard({ userId, onLogout, onNavigate }: BusinessDashboardProps) {
  const tc = useThemeClasses();
  const navigate = React.useCallback((screen: string) => {
    try {
      if (onNavigate) {
        onNavigate(screen);
        return;
      }
      (window as any).__borderpay_navigate?.(screen);
    } catch {
      /* noop */
    }
  }, [onNavigate]);
  const stored = useMemo(() => authAPI.getStoredUser() || {}, []);
  const businessNameCacheKey = useMemo(() => `${BIZ_NAME_KEY_PREFIX}${userId}`, [userId]);
  const cachedBusinessName = useMemo(() => {
    try { return String(localStorage.getItem(businessNameCacheKey) || '').trim(); } catch { return ''; }
  }, [businessNameCacheKey]);
  const initialCompanyName = useMemo(
    () => {
      const company = String(stored?.company_name || '').trim();
      if (company) return company;
      if (cachedBusinessName) return cachedBusinessName;
      return 'Business account';
    },
    [stored, cachedBusinessName],
  );
  const initialCountry = useMemo(
    () => (stored?.country ? String(stored.country) : null),
    [stored],
  );

  const [companyName, setCompanyName]               = useState<string>(initialCompanyName);
  const [registrationNumber, setRegistrationNumber] = useState<string | null>(null);
  const [country, setCountry]                       = useState<string | null>(initialCountry);
  const [profileError, setProfileError]             = useState<string | null>(null);
  const initialAffiliateKycStatus = useMemo<'verified' | 'pending'>(() => {
    return deriveKycStatus({ ...stored, account_type: 'business' }) === 'verified' ? 'verified' : 'pending';
  }, [stored]);
  const [affiliateKycStatus, setAffiliateKycStatus] = useState<'verified' | 'pending'>(initialAffiliateKycStatus);
  const [verificationResolved, setVerificationResolved] = useState<boolean>(initialAffiliateKycStatus === 'verified');

  // Seed wallets from cache so the balance + treasury paint instantly.
  const bizWalletsCacheKey = useMemo(
    () => financialCacheKey(BIZ_WALLETS_KEY, { userId, accountType: 'business' }),
    [userId],
  );
  const cachedBizWallets = useMemo(() => readBizWallets(bizWalletsCacheKey), [bizWalletsCacheKey]);
  const bizVaCacheKey = useMemo(
    () => financialCacheKey(BIZ_DASH_VA_KEY, { userId, accountType: 'business' }),
    [userId],
  );
  const cachedBizVirtualAccounts = useMemo(() => {
    try {
      const raw = localStorage.getItem(bizVaCacheKey);
      return normalizeBusinessVaRows(raw ? JSON.parse(raw) : [], initialCountry);
    } catch {
      return [];
    }
  }, [bizVaCacheKey, initialCountry]);
  const bizTxCacheKey = useMemo(
    () => financialCacheKey(BIZ_TX_KEY, { userId, accountType: 'business' }),
    [userId],
  );
  const cachedBizTransactions = useMemo(() => readBizTx(bizTxCacheKey), [bizTxCacheKey]);
  const [wallets, setWallets]             = useState<WalletRow[]>(cachedBizWallets);
  const [virtualAccounts, setVirtualAccounts] = useState<BusinessVaRow[]>(cachedBizVirtualAccounts);
  const [selectedVa, setSelectedVa] = useState<BusinessVaRow | null>(null);
  const walletsRef = useRef<WalletRow[]>(cachedBizWallets);
  const [transactions, setTransactions]   = useState<any[]>(cachedBizTransactions);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletsError, setWalletsError]   = useState<string | null>(null);
  const [hasVirtualAccounts, setHasVirtualAccounts] = useState<boolean>(() => hasActiveCachedVa(userId));
  const walletsLoadInFlightRef = useRef<Promise<void> | null>(null);
  const [hasPIN, setHasPIN] = useState<boolean>(() => {
    try { return !!SecurityStatus.get(userId).hasPIN; } catch { return false; }
  });
  const [has2FA, setHas2FA] = useState<boolean>(() => {
    try { return !!SecurityStatus.get(userId).has2FA || TOTPManager.isEnabled(userId); } catch { return false; }
  });
  const setupBannerDismissKey = useMemo(
    () => `borderpay_business_setup_banner_dismissed:${userId}`,
    [userId],
  );
  const [setupBannerDismissed, setSetupBannerDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(setupBannerDismissKey) === '1'; } catch { return false; }
  });

  useEffect(() => {
    navPerfTrackCache('dashboard', cachedBizWallets.length > 0 || cachedBizTransactions.length > 0);
  }, [cachedBizWallets.length, cachedBizTransactions.length]);

  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);

  const usdLikeTotal = useMemo(
    () => wallets.filter(w => ['USD', 'USDT', 'USDC'].includes(w.currency))
                 .reduce((s, w) => s + (w.balance || 0), 0),
    [wallets],
  );
  const spendableWallets = useMemo(
    () => wallets.filter(isSpendableBusinessWallet),
    [wallets],
  );
  const accountChipCount = spendableWallets.length + virtualAccounts.length;

  const toWalletRows = (raw: any[]): WalletRow[] => raw.map((w: any) => ({
    currency: String(w?.currency || '').toUpperCase(),
    balance: parseFloat(w?.balance) || 0,
  })).filter((w: WalletRow) => !!w.currency && isSpendableBusinessWallet(w));

  const loadWallets = async (force = false) => {
    if (walletsLoadInFlightRef.current) {
      await walletsLoadInFlightRef.current;
      return;
    }
    const run = (async () => {
    const seededWallets = walletsRef.current.length > 0 ? walletsRef.current : readBizWallets(bizWalletsCacheKey);
    if (wallets.length === 0) setWalletsLoading(true);
    // Never hard-block first paint with wallet skeletons on business dashboard.
    setWalletsError(null);
    try {
      const refreshTsKey = financialCacheKey(BIZ_DASH_REFRESH_TS_KEY, { userId, accountType: 'business' });
      const last = Number(localStorage.getItem(refreshTsKey) || '0');
      if (verificationResolved && !force && seededWallets.length > 0 && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const walletRouteRes: any = await withTimeout(
        backendAPI.financial.getWalletRouteData(),
        1_400,
        { success: false, error: 'wallet_route_timeout' } as any,
      );
      const walletOk = walletRouteRes?.success;
      if (walletOk) {
        const walletData = walletRouteRes?.data || {};
        const raw = Array.isArray(walletData?.wallets) ? walletData.wallets : [];
        const formatted = toWalletRows(raw);
        setWallets(formatted);
        const vaRows = normalizeBusinessVaRows(walletData?.virtual_accounts, country);
        setVirtualAccounts(vaRows);
        setHasVirtualAccounts(prev => prev || vaRows.length > 0);
        try { localStorage.setItem(bizWalletsCacheKey, JSON.stringify(formatted)); } catch { /* noop */ }
        try { localStorage.setItem(bizVaCacheKey, JSON.stringify(vaRows)); } catch { /* noop */ }
        try { localStorage.setItem(refreshTsKey, String(Date.now())); } catch { /* noop */ }
      } else {
        // Fallback path: if wallet route data fails, try canonical snapshot so
        // Accounts can still render without a hard error on dashboard.
        const snapshotRes: any = await withTimeout(
          backendAPI.financial.getSnapshot(12),
          1_400,
          { success: false, error: 'snapshot_timeout' } as any,
        );
        const snapshotOk = snapshotRes?.success;
        if (snapshotOk) {
          const raw = Array.isArray(snapshotRes?.data?.wallets) ? snapshotRes.data.wallets : [];
          const formatted = toWalletRows(raw);
          if (formatted.length > 0 || wallets.length === 0) {
            setWallets(formatted);
            try { localStorage.setItem(bizWalletsCacheKey, JSON.stringify(formatted)); } catch { /* noop */ }
          }
          const vaRows = normalizeBusinessVaRows(snapshotRes?.data?.virtual_accounts, country);
          setVirtualAccounts(vaRows);
          setHasVirtualAccounts(prev => prev || vaRows.length > 0);
          try { localStorage.setItem(bizVaCacheKey, JSON.stringify(vaRows)); } catch { /* noop */ }
        } else if (seededWallets.length === 0) {
          setWalletsError(friendlyError(walletRouteRes?.error || snapshotRes?.error, 'Could not load wallets'));
        }
      }

      // Never block first paint on profile/transaction enrichment.
      void Promise.allSettled([
        withTimeout(
          backendAPI.financial.getSnapshot(12),
          1_400,
          { success: false, error: 'snapshot_timeout' } as any,
        ),
        withTimeout(
          backendAPI.user.getProfile(),
          1_400,
          { success: false, error: 'profile_timeout' } as any,
        ),
        withTimeout(
          backendAPI.auth.getSecurityStatus(userId),
          1_400,
          { success: false, error: 'security_timeout' } as any,
        ),
      ]).then(([txRes, profileRes, secRes]) => {
        const txOk = txRes.status === 'fulfilled' && (txRes.value as any)?.success;
        if (txOk) {
          const tx = Array.isArray((txRes as PromiseFulfilledResult<any>).value?.data?.recent_transactions)
            ? (txRes as PromiseFulfilledResult<any>).value.data.recent_transactions
            : [];
          setTransactions(tx);
          try { localStorage.setItem(bizTxCacheKey, JSON.stringify(tx)); } catch { /* noop */ }
        }

        const profileOk = profileRes.status === 'fulfilled' && (profileRes.value as any)?.success;
        if (profileOk) {
          const profile = (profileRes as PromiseFulfilledResult<any>).value?.data?.user || {};
          const nextCompany = String(profile?.company_name || '').trim();
          const nextCountry = String(profile?.country || '').trim();
          const nextReg = String(profile?.registration_number || '').trim();
          if (nextCompany) setCompanyName(nextCompany);
          if (nextCountry) setCountry(nextCountry);
          if (nextReg) setRegistrationNumber(nextReg);
          if (!nextCompany) {
            // One-time fallback for business profile rows where /user/profile can
            // lag behind company_name replication.
            void withTimeout(
              backendAPI.business.getProfile(),
              1_400,
              { success: false } as any,
            ).then((biz: any) => {
              const company_name = String(biz?.data?.company_name || '').trim();
              const r = { data: { company_name } } as any;
              const company_name_fallback = r.data.company_name || initialCompanyName;
              if (!company_name && company_name_fallback) setCompanyName(company_name_fallback);
              if (!company_name) return;
              setCompanyName(company_name);
              try {
                const latest = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
                localStorage.setItem('borderpay_user', JSON.stringify({ ...latest, account_type: 'business', company_name }));
                localStorage.setItem(businessNameCacheKey, company_name);
              } catch { /* noop */ }
            });
          }
          const nextKybStatus = deriveKycStatus({ ...profile, account_type: 'business' }) === 'verified'
            ? 'verified'
            : 'pending';
          setAffiliateKycStatus(nextKybStatus);
          setVerificationResolved(true);
          setProfileError(null);
          try {
            const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
            localStorage.setItem('borderpay_user', JSON.stringify({
              ...cached,
              account_type: 'business',
              ...(nextCompany ? { company_name: nextCompany } : {}),
              ...(nextCountry ? { country: nextCountry } : {}),
              ...(nextReg ? { registration_number: nextReg } : {}),
            }));
            if (nextCompany) localStorage.setItem(businessNameCacheKey, nextCompany);
          } catch { /* ignore cache write */ }
        }

        const secOk = secRes.status === 'fulfilled' && (secRes.value as any)?.success;
        const secValue = secOk ? (secRes as PromiseFulfilledResult<any>).value?.data : null;
        if (secValue) {
          const pin = !!secValue?.pin_set;
          const twofa = !!secValue?.two_factor_enabled || TOTPManager.isEnabled(userId);
          setHasPIN(pin);
          setHas2FA(twofa);
        }
      });
    } catch (e: any) {
      if (seededWallets.length === 0) setWalletsError(friendlyError(e, 'Could not load wallets'));
      // Never block or scare users with profile-setup errors on transient
      // dashboard/network failures. Keep the identity header populated from
      // cached auth data and refresh profile in the background.
      setProfileError(null);
    } finally {
      setWalletsLoading(false);
    }
    })();
    walletsLoadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (walletsLoadInFlightRef.current === run) {
        walletsLoadInFlightRef.current = null;
      }
    }
  };

  useEffect(() => {
    loadWallets();
    const onFocus = () => { void loadWallets(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadWallets();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const prewarmKey = `borderpay_business_dashboard_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (Number.isFinite(last) && Date.now() - last < 180_000) return;
      const prefetch = (window as any).__borderpay_prefetch;
      if (typeof prefetch !== 'function') return;
      const warm = () => {
        [
          'wallet-detail',
          'add-wallet',
          'send-money',
          'receive-money',
          'transactions',
          'team',
          'settings',
          'profile',
          'bulk-payout',
          'payroll',
          'exchange',
          'cards',
          'external-accounts',
          'external-wallets',
          'notifications',
          'support',
          'help-center',
        ].forEach((s) => {
          try { prefetch(s); } catch { /* noop */ }
        });
      };
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(warm, { timeout: 1000 });
      else setTimeout(warm, 120);
      sessionStorage.setItem(prewarmKey, String(Date.now()));
    } catch { /* noop */ }
  }, [userId]);

  const refreshAll = () => { loadWallets(true); };
  const openWalletForCurrency = (currency: string) => {
    try { sessionStorage.setItem('borderpay_open_wallet_currency', String(currency || '').toUpperCase()); } catch { /* noop */ }
    navigate('wallet-detail');
  };
  const kybVerified = affiliateKycStatus === 'verified';
  const setupSteps = [
    { id: '2fa', label: 'Enable 2FA', completed: has2FA, screen: 'two-factor-setup' },
    { id: 'pin', label: 'Set transaction PIN', completed: hasPIN, screen: 'pin-setup' },
    { id: 'kyb', label: 'Complete business verification', completed: kybVerified, screen: 'kyc' },
  ];
  const showSetupBanner = !setupSteps.every((s) => s.completed);
  const effectiveShowSetupBanner = verificationResolved && showSetupBanner && !setupBannerDismissed;

  const initials = (companyName || 'B').slice(0, 2).toUpperCase();

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="mx-auto w-full max-w-screen-xl">
      {/* ── 1. Business identity row ─────────────────────────────────── */}
      <section className="flex items-center justify-between px-5 sm:px-6 pt-5 gap-3 md:pt-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#C7FF00] flex items-center justify-center text-black font-bold text-sm flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className={`text-[10px] uppercase tracking-[0.16em] ${tc.textMuted} font-semibold`}>Business</p>
            {companyName ? (
              <h1 className={`text-base font-semibold ${tc.text} truncate`}>{companyName}</h1>
            ) : (
              <div className={`h-5 w-36 rounded ${tc.bgAlt} animate-pulse`} aria-label="Loading business name" />
            )}
          </div>
        </div>
        <button
          onClick={refreshAll}
          className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center ${tc.hoverBg} flex-shrink-0`}
          aria-label="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${tc.text} ${walletsLoading ? 'animate-spin' : ''}`} />
        </button>
      </section>

      <div className="space-y-6 pb-6 md:pb-10">
        {/* ── 2. Hero balance ───────────────────────────────────────── */}
        <section className="px-5 sm:px-6 pt-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] px-5 pt-5 pb-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
            <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full bg-[#C7FF00] opacity-[0.06] blur-3xl" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-semibold mb-3">
                  Total balance · USD
                </p>
                <div className="flex items-end gap-2">
                  <h2 className="text-white font-semibold tracking-tight tabular-nums leading-none text-[44px] sm:text-[56px]">
                    <span className="text-2xl sm:text-3xl text-white/50 mr-1 align-top">$</span>
                    {usdLikeTotal.toFixed(2).split('.')[0]}
                    <span className="text-2xl sm:text-3xl text-white/50">.{usdLikeTotal.toFixed(2).split('.')[1]}</span>
                  </h2>
                </div>
                <p className="text-[11px] text-white/40 mt-2">
                  {wallets.length === 0
                    ? 'No accounts yet. Open one to start.'
                    : `Across ${wallets.length} ${wallets.length === 1 ? 'account' : 'accounts'}`}
                </p>
              </div>
              {(registrationNumber || country) && (
                <p className="max-w-[42%] text-[10px] text-white/40 font-mono uppercase tracking-wide truncate text-right">
                  {[registrationNumber, country].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </section>

        {effectiveShowSetupBanner && (
          <section className="px-5 sm:px-6">
            <div className={`rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3.5`}>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-300" />
                  <p className={`text-sm font-semibold ${tc.text}`}>Complete your setup</p>
                </div>
                <button
                  onClick={() => {
                    setSetupBannerDismissed(true);
                    try { sessionStorage.setItem(setupBannerDismissKey, '1'); } catch { /* noop */ }
                  }}
                  className="text-amber-200/80 hover:text-amber-100 text-sm font-semibold"
                  aria-label="Dismiss setup banner"
                >
                  ×
                </button>
              </div>
              <div className="space-y-2">
                {setupSteps.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => {
                      if (step.completed) return;
                      if (step.id === 'kyb') {
                        try { sessionStorage.setItem('borderpay_auto_start_verification_v1', '1'); } catch { /* noop */ }
                      }
                      navigate(step.screen);
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-2 py-1.5 ${!step.completed ? tc.hoverBg : ''}`}
                  >
                    <span className={`text-xs ${step.completed ? tc.textMuted : tc.text}`}>{step.label}</span>
                    <span className={`text-[11px] font-semibold ${step.completed ? 'text-[#C7FF00]' : 'text-amber-300'}`}>
                      {step.completed ? 'Done' : 'Complete'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── 3. Accounts strip (parity with individual dashboard) ─── */}
        <section>
          <div className="px-4 sm:px-5 flex items-center justify-between mb-3">
            <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>Accounts</h3>
            {accountChipCount > 0 && (
              <button
                onPointerDown={() => prefetchScreen('wallet-detail')}
                onMouseEnter={() => prefetchScreen('wallet-detail')}
                onTouchStart={() => prefetchScreen('wallet-detail')}
                onClick={() => {
                  try { sessionStorage.removeItem('borderpay_open_wallet_currency'); } catch { /* noop */ }
                  navigate('wallet-detail');
                }}
                className="text-[11px] font-semibold text-[#C7FF00]"
              >
                See all
              </button>
            )}
          </div>

          <div className="overflow-x-auto pb-1 -mb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="px-4 sm:px-5 flex gap-2.5 min-w-min">
              {accountChipCount === 0 ? (
                <button
                  onPointerDown={() => prefetchScreen('add-wallet')}
                  onMouseEnter={() => prefetchScreen('add-wallet')}
                  onTouchStart={() => prefetchScreen('add-wallet')}
                  onClick={() => navigate('add-wallet')}
                  className={`flex-shrink-0 w-[220px] rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 text-left ${tc.hoverBg} transition-colors`}
                >
                  <div className={`w-8 h-8 rounded-full ${tc.bgAlt} flex items-center justify-center mb-3`}>
                    <Plus className={`w-4 h-4 ${tc.text}`} />
                  </div>
                  <p className={`text-[13px] font-semibold ${tc.text}`}>Open your first account</p>
                  <p className={`text-[10px] ${tc.textMuted} mt-0.5`}>Activate available accounts for your business.</p>
                </button>
              ) : (
                <>
                  {spendableWallets.map((w) => (
                    <button
                      key={w.currency}
                      onPointerDown={() => prefetchScreen('wallet-detail')}
                      onMouseEnter={() => prefetchScreen('wallet-detail')}
                      onTouchStart={() => prefetchScreen('wallet-detail')}
                      onClick={() => openWalletForCurrency(w.currency)}
                      className={`flex-shrink-0 w-[164px] min-h-[156px] rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-4 text-center flex flex-col items-center justify-center ${tc.hoverBg} transition-colors`}
                    >
                      <BizCurrencyIcon currency={w.currency} />
                      <p className={`w-full text-[14px] font-semibold ${tc.text} mt-3 truncate`}>
                        {CURRENCY_LABEL[String(w.currency || '').toUpperCase()] || w.currency}
                      </p>
                      <p className={`w-full text-[18px] font-bold ${tc.text} mt-2 tabular-nums truncate`}>
                        {formatBusinessWalletBalance(w)}
                      </p>
                    </button>
                  ))}
                  {virtualAccounts.map((va) => (
                    <button
                      key={`va:${va.currency}`}
                      onPointerDown={() => prefetchScreen('wallet-detail')}
                      onMouseEnter={() => prefetchScreen('wallet-detail')}
                      onTouchStart={() => prefetchScreen('wallet-detail')}
                      onClick={() => setSelectedVa(va)}
                      className={`flex-shrink-0 w-[164px] min-h-[156px] rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-4 text-center flex flex-col items-center justify-center ${tc.hoverBg} transition-colors`}
                    >
                      <BizCurrencyIcon currency={va.currency} />
                      <p className={`w-full text-[14px] font-semibold ${tc.text} mt-3 truncate`}>
                        {CURRENCY_LABEL[String(va.currency || '').toUpperCase()] || va.currency}
                      </p>
                    </button>
                  ))}
                  <button
                    onPointerDown={() => prefetchScreen('add-wallet')}
                    onMouseEnter={() => prefetchScreen('add-wallet')}
                    onTouchStart={() => prefetchScreen('add-wallet')}
                    onClick={() => navigate('add-wallet')}
                    className={`flex-shrink-0 w-[145px] rounded-2xl border border-dashed ${tc.cardBorder} px-4 py-3.5 text-left ${tc.hoverBg} transition-colors`}
                    aria-label="Add account"
                  >
                    <div className={`w-8 h-8 rounded-full ${tc.bgAlt} flex items-center justify-center mb-3`}>
                      <Plus className={`w-4 h-4 ${tc.text}`} />
                    </div>
                    <p className={`text-[11px] ${tc.textMuted} uppercase tracking-wider font-semibold`}>New</p>
                    <p className={`text-[13px] font-semibold ${tc.text} mt-0.5`}>Add account</p>
                  </button>
                </>
              )}
            </div>
          </div>
          {walletsError && (
            <div className="px-4 sm:px-5 mt-2">
              <button
                onClick={() => loadWallets(true)}
                className="text-[11px] text-[#C7FF00] font-semibold inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Retry loading accounts
              </button>
            </div>
          )}
        </section>

        {/* ── 4. Quick actions ─────────────────────────────────────── */}
        <section className="px-5 sm:px-6">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            <BizChip label="Send"    Icon={Send}     onPrefetch={() => prefetchScreen('send-money')}       onClick={() => navigate('send-money')}    tc={tc} />
            <BizChip label="Receive" Icon={Download} onPrefetch={() => prefetchScreen('receive-money')}    onClick={() => navigate('receive-money')} tc={tc} />
            <BizChip label="Activity" Icon={FileText} onPrefetch={() => prefetchScreen('transactions')}    onClick={() => navigate('transactions')} tc={tc} />
            <BizChip label="Payouts" Icon={Banknote} onPrefetch={() => prefetchScreen('bulk-payout')}      onClick={() => navigate('bulk-payout')}   tc={tc} primary />
            <BizChip label="Team"    Icon={Users}    onPrefetch={() => prefetchScreen('team')}             onClick={() => navigate('team')}          tc={tc} />
            <BizChip
              label={PAYROLL_RUNTIME_ENABLED ? 'Payroll' : 'Payroll Soon'}
              Icon={BriefcaseBusiness}
              onPrefetch={() => prefetchScreen('payroll')}
              onClick={() => navigate('payroll')}
              tc={tc}
              disabled={!PAYROLL_RUNTIME_ENABLED}
            />
            <BizChip
              label="FX"
              Icon={ArrowRightLeft}
              onPrefetch={() => prefetchScreen('exchange')}
              onClick={() => navigate('exchange')}
              tc={tc}
            />
            <BizChip label="Cards" Icon={CreditCard} onPrefetch={() => prefetchScreen('cards')} onClick={() => onNavigate('cards')} tc={tc} />
          </div>
        </section>

        {/* ── Treasury management ─────────────────────────────────── */}
        <TreasuryCard totalUsd={usdLikeTotal} wallets={wallets} transactions={transactions} userId={userId} />

        {/* Profile error */}
        {profileError && (
          <section className="px-5 sm:px-6">
            <div className="rounded-2xl bg-amber-500/[0.06] border border-amber-500/20 px-4 py-3 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className={`text-xs ${tc.text}`}>{profileError}</p>
            </div>
          </section>
        )}

        {/* ── 6. BorderPay infrastructure ──────────────────────────── */}
        <section className="px-5 sm:px-6 space-y-2.5">
          <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em] mb-3`}>
            Business infrastructure
          </h2>
          {verificationResolved && !kybVerified && (
            <BridgeKycStatusCard userId={userId} onStartVerification={() => onNavigate('kyc')} />
          )}
          <CardsLockedCard />
        </section>

        {/* ── 6b. Exchange rates (shared with individual dashboard) ─ */}
        {FX_NAV_ENABLED && <ExchangeRateWidget onNavigate={onNavigate} />}

        {/* ── 6c. Affiliate banner (footer position parity) ───────── */}
        <section className="px-5 sm:px-6">
          <AffiliateBanner kycStatus={affiliateKycStatus} />
        </section>

        {/* ── 7. Trust line ────────────────────────────────────────── */}
        <section className="px-5 sm:px-6 pt-1 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-[#C7FF00]" />
          <span className={`text-[10px] ${tc.textMuted}`}>Secured by BorderPay Africa</span>
        </section>
      </div>
      <AccountDetailSheet
        open={!!selectedVa}
        onClose={() => setSelectedVa(null)}
        va={selectedVa ? {
          currency: selectedVa.currency,
          rail: selectedVa.rail,
          status: selectedVa.status,
          account_details: selectedVa.account_details,
        } : null}
      />
      </div>
    </div>
  );
}

// ── BizChip ─────────────────────────────────────────────────────────────
// Outlined chip-style action button used in the BusinessDashboard quick-row.
// `primary` swaps the background to lime (used for "Team" so the team-mgmt
// surface gets visual priority for business owners).
function BizChip({
  label, Icon, onClick, onPrefetch, primary, tc, disabled,
}: {
  label:    string;
  Icon:     React.ComponentType<{ className?: string }>;
  onClick:  () => void;
  onPrefetch?: () => void;
  primary?: boolean;
  tc:       ReturnType<typeof useThemeClasses>;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onPointerDown={onPrefetch}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl py-3.5 transition-colors active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed ${
        primary
          ? 'bg-[#C7FF00] text-black hover:brightness-95'
          : `${tc.card} border ${tc.cardBorder} ${tc.text} ${tc.hoverBg}`
      }`}
    >
      <Icon className={`w-[18px] h-[18px] ${primary ? 'text-black' : ''}`} />
      <span className={`text-[11px] font-semibold ${primary ? 'text-black' : tc.text}`}>{label}</span>
    </button>
  );
}

function BizCurrencyIcon({ currency }: { currency: string }) {
  const code = String(currency || '').toUpperCase();
  const flag: Record<string, string> = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧' };
  const [imgFailed, setImgFailed] = React.useState(false);
  const iconUrl = STABLE_ICON_URL[code];

  if (flag[code]) {
    return (
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden bg-white/10 text-[30px] leading-none"
        aria-hidden
      >
        {flag[code]}
      </div>
    );
  }

  if (iconUrl && !imgFailed) {
    return (
      <div className="w-12 h-12 rounded-full overflow-hidden bg-white/5 flex items-center justify-center" aria-hidden>
        <img
          src={iconUrl}
          alt=""
          className="w-10 h-10 object-contain"
          onError={() => setImgFailed(true)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div
      className="w-12 h-12 rounded-full flex items-center justify-center font-mono text-[12px] font-bold"
      style={{ backgroundColor: `${CURRENCY_COLOR[code] || '#666666'}26`, color: CURRENCY_COLOR[code] || '#666666' }}
      aria-hidden
    >
      {code.slice(0, 3)}
    </div>
  );
}

export default BusinessDashboard;
