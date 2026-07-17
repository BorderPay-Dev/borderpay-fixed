/**
 * BorderPay Africa - Dashboard
 * Fully wired to backend API:
 * - /user/profile  → user info, KYC status, 2FA
 * - /wallets       → wallet balances
 * - /transactions  → recent activity
 * - /auth/security/status → PIN setup status
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Bell,
  Plus,
  Send,
  ChevronRight,
  Eye,
  EyeOff,
  Settings,
  Home,
  Coins,
  Wallet,
  CreditCard,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  X,
  Lock,
  ShieldAlert,
  Gift,
  TrendingUp,
  TrendingDown,
  Activity,
} from 'lucide-react';
import { authAPI, storeUserProfile, supabase } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { deriveKycStatus, isKycVerified } from '../../utils/config/environment';
import { SecurityStatus, TOTPManager } from '../../utils/security/SecurityManager';
import { NotificationBell } from '../notifications/NotificationBell';
import { AccountStatusBadge, AccountStatus } from '../activation/AccountStatusBadge';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { usePreferences } from '../../utils/hooks/usePreferences';
import { AffiliateBanner } from '../referral/AffiliateBanner';
import { prefetchScreen } from './MainApp';
import { BridgeKycStatusCard } from '../dashboard/bridge/BridgeKycStatusCard';
import { ExchangeRateWidget } from '../dashboard/fx/ExchangeRateWidget';
import { CardsLockedCard } from '../dashboard/bridge/CardsLockedCard';
import { AccountDetailSheet } from '../dashboard/bridge/WalletVisuals';
import { Skeleton } from '../common/Skeleton';
import { KycReminderPopup } from '../activation/KycReminderPopup';
import { txDirection } from '../../utils/transactions/direction';
import { normalizeTransactionReceipt } from '../../utils/transactions/receipt';
import { sanitizeCustomerFacingText } from '../../utils/presentation/customerBranding';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { FX_NAV_ENABLED } from '../../utils/featureFlags';
import { bridgeVirtualAccountCurrenciesForCountry } from '../../utils/compliance/partnerCountryPolicy';

// Pull cached profile once at module-eval — every initial-state hook below
// reads from this synchronously so the dashboard never flickers.
function readCachedProfile(): any {
  try {
    const raw = localStorage.getItem('borderpay_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Lightweight JSON cache so balance + recent activity paint instantly on every
// open (native-app feel), then refresh in the background. Keys are versioned.
const DASH_WALLETS_KEY = 'borderpay_dash_wallets_v1';
const DASH_RECENT_KEY  = 'borderpay_dash_recent_tx_v1';
function readJSON<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}
function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota/private mode */ }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function initialsFromName(name?: string, email?: string): string {
  const src = (name || '').trim() || (email || '').trim();
  if (!src) return '';
  const parts = src.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface DashboardProps {
  userId: string;
  onLogout: () => void;
  onNavigate?: (screen: string) => void;
  currentScreen?: string;
}

const CURRENCY_CONFIG: Record<string, { symbol: string; color: string }> = {
  USD:  { symbol: '$',  color: '#10B981' },
  EUR:  { symbol: '€',  color: '#3B82F6' },
  GBP:  { symbol: '£',  color: '#8B5CF6' },
  USDT: { symbol: '₮',  color: '#26A17B' },
  USDC: { symbol: '$',  color: '#2775CA' },
};

const CURRENCY_LABEL: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  USDT: 'Tether USD',
  USDC: 'USD Coin',
  PYUSD: 'PayPal USD',
  USDB: 'USDB',
  EURC: 'Euro Coin',
};

const STABLE_ICON_URL: Record<string, string> = {
  USDC: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdc.png',
  USDT: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/usdt.png',
  PYUSD: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/pyusd.png',
  EURC: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/eurc.png',
};

type DashboardWalletRow = { currency: string; balance: number; symbol: string; color: string };
type DashboardVaRow = {
  id: string;
  currency: string;
  rail?: string | null;
  status?: string;
  account_details: any;
  bridge_virtual_account_id?: string;
  created_at?: string;
  updated_at?: string;
};
const ACTIVE_DASHBOARD_VA_STATUSES = new Set(['active', 'approved', 'enabled', 'ready', 'provisioned']);

function normalizeDashboardVaRows(raw: unknown, country: string | null | undefined): DashboardVaRow[] {
  if (!Array.isArray(raw)) return [];
  const allowed = bridgeVirtualAccountCurrenciesForCountry(country);
  const byCurrency = new Map<string, DashboardVaRow>();
  raw.forEach((row: any) => {
    const currency = String(row?.currency || '').toUpperCase();
    const status = String(row?.status || '').trim().toLowerCase();
    if (!allowed.includes(currency as any)) return;
    if (!ACTIVE_DASHBOARD_VA_STATUSES.has(status)) return;
    const next: DashboardVaRow = {
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

function isSpendableDashboardWallet(row: { balance?: number }): boolean {
  const balance = Number(row?.balance || 0);
  return Number.isFinite(balance) && balance > 0;
}

function formatDashboardWalletBalance(row: { currency: string; balance: number }): string {
  const code = String(row.currency || '').toUpperCase();
  const symbol = CURRENCY_CONFIG[code]?.symbol;
  const formatted = Number(row.balance || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return symbol ? `${symbol}${formatted}` : `${formatted} ${code}`;
}

export function Dashboard({ userId, onLogout, onNavigate, currentScreen: parentScreen }: DashboardProps) {
  // Synchronous read — no flicker between "unconfirmed/starter" and the real
  // status. If we have a cached profile, derive everything at first render.
  const cachedProfile = useMemo(() => readCachedProfile(), []);
  const cachedSecurity = useMemo(() => {
    try { return SecurityStatus.get(userId); } catch { return { hasPIN: false, has2FA: false }; }
  }, [userId]);
  const cachedKycStatus = deriveKycStatus(cachedProfile);
  const isCachedVerified = cachedKycStatus === 'verified';
  const cachedIdentity = useMemo(() => {
    const stored = authAPI.getStoredUser() as any;
    const meta = stored?.user_metadata || {};
    const fullName =
      cachedProfile?.full_name ||
      stored?.full_name ||
      meta?.full_name ||
      '';
    const email =
      cachedProfile?.email ||
      stored?.email ||
      '';
    return { fullName: String(fullName || ''), email: String(email || '') };
  }, [cachedProfile]);
  // Canonical 2FA signal (LoginScreen uses TOTPManager) so the dashboard agrees.
  const cached2FA = useMemo(() => {
    try { return !!cachedSecurity.has2FA || TOTPManager.isEnabled(userId); } catch { return !!cachedSecurity.has2FA; }
  }, [cachedSecurity, userId]);

  const [isVerified, setIsVerified]       = useState<boolean>(!!isCachedVerified);
  const [kycStatus, setKycStatus]         = useState(cachedKycStatus);
  const [verificationResolved, setVerificationResolved] = useState<boolean>(isCachedVerified);
  const { prefs, updatePrefs } = usePreferences();
  const [balanceHidden, setBalanceHidden] = useState(prefs.hide_balance);
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(() => cachedProfile?.profile_picture_url || null);
  const [profilePicLoaded, setProfilePicLoaded] = useState(false);
  const [userFullName, setUserFullName]   = useState<string>(cachedIdentity.fullName);
  const [userCountry, setUserCountry]     = useState<string | null>(() =>
    cachedProfile?.country ? String(cachedProfile.country).toUpperCase() : null,
  );
  const dashboardLoadInFlightRef = useRef<Promise<void> | null>(null);
  // Derive an initial account status from the cached profile so we never
  // first-paint "starter" on a verified user.
  const [accountStatus, setAccountStatus] = useState<AccountStatus>(() => {
    if (cachedSecurity.hasPIN && cached2FA && isCachedVerified) return 'active';
    if (isCachedVerified) return 'verified';
    if (cachedKycStatus === 'rejected') return 'rejected';
    return 'starter';
  });
  const [has2FA, setHas2FA]               = useState<boolean>(cached2FA);
  // True once a network refresh of `getSecurityStatus` has completed at least
  // once. The "set up 2FA" banner is gated on this so it never flashes for a
  // user who actually HAS 2FA but whose local cache hasn't been seeded yet
  // (the COO on a fresh browser).
  const [securityLoaded, setSecurityLoaded] = useState<boolean>(false);
  // Legacy provider status state removed — AffiliateBanner now gates on Bridge KYC only.
  const [userEmail, setUserEmail]         = useState<string>(cachedIdentity.email);
  const [hasPIN, setHasPIN]               = useState<boolean>(!!cachedSecurity.hasPIN);
  // Seed wallets / balance / recent activity from cache so the dashboard never
  // first-paints $0.00 or an empty activity list, then refreshes silently.
  const dashWalletsKey = useMemo(() => financialCacheKey(DASH_WALLETS_KEY, { userId }), [userId]);
  const dashRecentKey = useMemo(() => financialCacheKey(DASH_RECENT_KEY, { userId }), [userId]);
  const dashRefreshTsKey = useMemo(
    () => financialCacheKey('borderpay_dashboard_refresh_ts_v1', { userId }),
    [userId],
  );
  const dashVaKey = useMemo(
    () => financialCacheKey('borderpay_dashboard_va_v1', { userId }),
    [userId],
  );
  const cachedWallets = useMemo(
    () => readJSON<DashboardWalletRow[]>(dashWalletsKey, []),
    [dashWalletsKey],
  );
  const cachedVirtualAccounts = useMemo(
    () => normalizeDashboardVaRows(readJSON<any[]>(dashVaKey, []), userCountry),
    [dashVaKey, userCountry],
  );
  const cachedRecent = useMemo(() => readJSON<any[]>(dashRecentKey, []), [dashRecentKey]);
  const usdLikeTotal = (ws: Array<{ currency: string; balance: number }>) =>
    ws.reduce((s, w) => s + Number(w.balance || 0), 0);
  const [wallets, setWallets]             = useState(cachedWallets);
  const spendableWallets = useMemo(
    () => wallets.filter(isSpendableDashboardWallet),
    [wallets],
  );
  const [virtualAccounts, setVirtualAccounts] = useState<DashboardVaRow[]>(cachedVirtualAccounts);
  const [selectedVa, setSelectedVa] = useState<DashboardVaRow | null>(null);
  const accountChipCount = spendableWallets.length + virtualAccounts.length;
  const [totalBalance, setTotalBalance]   = useState(() => usdLikeTotal(cachedWallets));
  const [walletsLoaded, setWalletsLoaded] = useState<boolean>(cachedWallets.length > 0);
  const [hasVirtualAccounts, setHasVirtualAccounts] = useState<boolean>(() =>
    cachedVirtualAccounts.length > 0,
  );
  const [recentTransactions, setRecentTransactions] = useState<any[]>(cachedRecent);
  // True once a network refresh of recent activity has completed at least once;
  // gates the skeleton so we only show it on a genuinely cold (uncached) load.
  const [txLoaded, setTxLoaded]           = useState<boolean>(cachedRecent.length > 0);
  // We hydrated synchronously — start with `loading: false` so banners that
  // were gated on `!loading` render immediately.
  const [loading, setLoading]             = useState(false);
  // Use parentScreen from MainApp for active state tracking; fallback to 'dashboard'
  const activeScreen = parentScreen || 'dashboard';

  // 2FA recommendation banner state (dismissible, persisted)
  const [show2FABanner, setShow2FABanner] = useState(() => {
    return localStorage.getItem('borderpay_2fa_banner_dismissed') !== 'true';
  });

  const dismiss2FABanner = () => {
    setShow2FABanner(false);
    localStorage.setItem('borderpay_2fa_banner_dismissed', 'true');
  };

  // Setup banner state — dismissible per session, reappears on next login.
  // If the user has previously completed all 4 setup steps, the banner is
  // permanently suppressed (localStorage flag), so it never flashes back
  // into view after a full refresh.
  const [showSetupBanner, setShowSetupBanner] = useState(() => {
    try {
      if (localStorage.getItem('borderpay_setup_complete') === 'true') return false;
    } catch {}
    return sessionStorage.getItem('borderpay_setup_banner_dismissed') !== 'true';
  });

  const dismissSetupBanner = () => {
    setShowSetupBanner(false);
    sessionStorage.setItem('borderpay_setup_banner_dismissed', 'true');
  };

  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // ─── navigation ───────────────────────────────────────────────────────────
  const handleNavigate = useCallback((screen: string) => {
    if (onNavigate) {
      onNavigate(screen);
      return;
    }
    try {
      (window as any).__borderpay_navigate?.(screen);
    } catch {
      /* noop */
    }
  }, [onNavigate]);

  const openWalletForCurrency = useCallback((currency: string) => {
    try { sessionStorage.setItem('borderpay_open_wallet_currency', String(currency || '').toUpperCase()); } catch { /* noop */ }
    handleNavigate('wallet-detail');
  }, [handleNavigate]);

  // ─── data loading ─────────────────────────────────────────────────────────
  const loadDashboardData = useCallback(async () => {
    if (dashboardLoadInFlightRef.current) {
      await dashboardLoadInFlightRef.current;
      return;
    }
    const run = (async () => {
    // Fast path: show cached user data immediately
    const storedUser = authAPI.getStoredUser();
    if (storedUser?.profile_picture_url) setProfilePicUrl(storedUser.profile_picture_url);

    try {
      // Prevent repeated network churn on fast route hops. Keep cache-first UX.
      try {
        const hasCached =
          readJSON<any[]>(dashWalletsKey, []).length > 0 ||
          readJSON<any[]>(dashRecentKey, []).length > 0;
        const last = Number(localStorage.getItem(dashRefreshTsKey) || '0');
        if (verificationResolved && hasCached && Number.isFinite(last) && Date.now() - last < 30_000) {
          setLoading(false);
          return;
        }
      } catch { /* noop */ }

      // Fire all snapshot/security requests in parallel from canonical
      // read-model sources.
      const [snapshotRes, securityRes] = await Promise.allSettled([
        withTimeout(
          backendAPI.financial.getSnapshot(5),
          1800,
          { success: false, data: null, error: 'snapshot_timeout' } as any,
        ),
        withTimeout(
          backendAPI.auth.getSecurityStatus(userId),
          1800,
          { success: false, data: null, error: 'security_timeout' } as any,
        ),
      ]);
      const snapshotOk = snapshotRes.status === 'fulfilled' && snapshotRes.value?.success;
      const snapshotData = snapshotOk ? (snapshotRes.value as any).data : null;

      // ── Profile ──────────────────────────────────────────────────────────
      if (snapshotData?.profile) {
        const p = snapshotData.profile;
        if (p) {
          const nextKycStatus = deriveKycStatus(p);
          const verified   = nextKycStatus === 'verified';
          // Only update if value changed — prevents an avoidable re-render
          // (and visible flicker) when nothing's actually different.
          setIsVerified(prev => prev === verified ? prev : verified);
          setKycStatus(prev => prev === nextKycStatus ? prev : nextKycStatus);
          setVerificationResolved(true);
          if (p.profile_picture_url) setProfilePicUrl(p.profile_picture_url);
          if (p.full_name) setUserFullName(p.full_name);
          if (p.email) setUserEmail(p.email);
          if (p.country) setUserCountry(String(p.country).toUpperCase());
          storeUserProfile(p);
        }
      }

      // ── Wallets ───────────────────────────────────────────────────────────
      // Spendable balances are wallet-settled only. Virtual accounts are
      // receive rails and tracked separately via snapshotData.virtual_accounts.
      {
        if (Array.isArray(snapshotData?.wallets)) {
          const raw = snapshotData.wallets || [];
          const rows: DashboardWalletRow[] = raw.map((w: any) => {
            const c = String(w?.currency || '').toUpperCase();
            return {
              currency: c,
              balance: Number(w?.balance || 0),
              symbol: CURRENCY_CONFIG[c]?.symbol || c,
              color: CURRENCY_CONFIG[c]?.color || '#666',
            };
          }).filter(isSpendableDashboardWallet);
          setWallets(rows);
          setTotalBalance(usdLikeTotal(rows));
          writeJSON(dashWalletsKey, rows);
        }
        if (Array.isArray(snapshotData?.virtual_accounts)) {
          const profileCountry = snapshotData?.profile?.country
            ? String(snapshotData.profile.country).toUpperCase()
            : userCountry;
          const vaRows = normalizeDashboardVaRows(snapshotData.virtual_accounts, profileCountry);
          setVirtualAccounts(vaRows);
          setHasVirtualAccounts(vaRows.length > 0);
          writeJSON(dashVaKey, vaRows);
        }
        // Loading must always terminate even when API fails; empty-state is
        // represented by zero rows, not an infinite loading placeholder.
        setWalletsLoaded(true);
      }
      // On failure we keep the cached wallets/balance already on screen rather
      // than flashing $0.00.

      // ── Security status (merge backend + client-side) ─────────────────────
      // Client-side localStorage is the source of truth for PIN/2FA
      const clientSecurity = SecurityStatus.get(userId);
      // TOTPManager is the canonical client signal for 2FA (LoginScreen uses it);
      // SecurityStatus alone misses it, which made the "set up 2FA" banner reappear.
      const totpOn = TOTPManager.isEnabled(userId);
      if (securityRes.status === 'fulfilled' && securityRes.value?.success) {
        const sec = securityRes.value.data as any;
        // Use OR across every source: if ANY says it's set, it's set.
        setHasPIN(sec?.pin_set || clientSecurity.hasPIN);
        setHas2FA(sec?.two_factor_enabled || clientSecurity.has2FA || totpOn);
        setSecurityLoaded(true);
      } else {
        setHasPIN(clientSecurity.hasPIN);
        setHas2FA(clientSecurity.has2FA || totpOn);
        // Do NOT setSecurityLoaded(true) on network failure — we'd rather hide
        // the "set up 2FA" banner than show it incorrectly to a real 2FA user.
      }

      // ── Recent transactions ───────────────────────────────────────────────
      if (Array.isArray(snapshotData?.transactions)) {
        const txns = snapshotData.transactions || [];
        const recent = Array.isArray(txns) ? txns.slice(0, 5) : [];
        setRecentTransactions(recent);
        writeJSON(dashRecentKey, recent);
      }
      // On failure keep cached recent activity rather than blanking it.
      setTxLoaded(true);
      try { localStorage.setItem(dashRefreshTsKey, String(Date.now())); } catch { /* noop */ }

    } catch (error) {
      // silent — synchronous cache already populated the UI
    } finally {
      // Fail-open: never leave dashboard in loading placeholders when refresh
      // fails or a partial parse throws. Cached data stays visible.
      setWalletsLoaded(true);
      setTxLoaded(true);
      setLoading(false);
    }
    })();
    dashboardLoadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (dashboardLoadInFlightRef.current === run) {
        dashboardLoadInFlightRef.current = null;
      }
    }
  }, [dashRecentKey, dashRefreshTsKey, dashVaKey, dashWalletsKey, userCountry, verificationResolved, userId]);

  useEffect(() => {
    loadDashboardData();
    const onFocus = () => { void loadDashboardData(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadDashboardData();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const prewarmKey = `borderpay_dashboard_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (Number.isFinite(last) && Date.now() - last < 180_000) return;
      const prefetch = (window as any).__borderpay_prefetch;
      if (typeof prefetch !== 'function') return;
      const warm = () => {
        ['wallet-detail', 'send-money', 'receive-money', 'transactions', 'exchange', 'settings', 'profile', 'notifications'].forEach((s) => {
          try { prefetch(s); } catch { /* noop */ }
        });
      };
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(warm, { timeout: 1000 });
      else setTimeout(warm, 120);
      sessionStorage.setItem(prewarmKey, String(Date.now()));
    } catch { /* noop */ }
  }, [userId]);

  // ─── setup steps ─────────────────────────────────────────────────────
  const setupSteps = [
    { id: 'account', label: t('activation.accountCreated'),                        completed: true,  screen: '' },
    { id: '2fa',     label: t('activation.2faEnabled'),                            completed: has2FA, screen: 'two-factor-setup' },
    { id: 'pin',     label: t('activation.pinSetup'),                              completed: hasPIN, screen: 'pin-setup' },
    { id: 'kyc',     label: t('activation.kycComplete'),                           completed: isVerified, screen: 'kyc' },
  ];

  // ─── account tier derivation ─────────────────────────────────────────
  // Promote to 'active' once every onboarding step is complete. Runs every
  // time one of the inputs changes so the badge and setup banner update
  // the moment the user finishes their last step.
  const allStepsComplete = has2FA && hasPIN && isVerified;
  useEffect(() => {
    setAccountStatus(allStepsComplete ? 'active' : isVerified ? 'verified' : kycStatus === 'rejected' ? 'rejected' : 'starter');
    // Permanently dismiss the setup banner once the user is fully set up
    // so it doesn't reappear on the next login.
    if (allStepsComplete) {
      try { localStorage.setItem('borderpay_setup_complete', 'true'); } catch {}
    }
  }, [allStepsComplete, isVerified, kycStatus]);

  const handleLockedFeatureClick = (_featureName: string, action: string) => {
    handleNavigate(action);
  };

  // ─── transaction helpers ──────────────────────────────────────────────────
  const getTxIcon = (txn: any) => {
    const isCredit = txn.type === 'deposit' || txn.type === 'credit';
    return isCredit ? (
      <ArrowDownLeft size={18} className="text-green-500" />
    ) : (
      <ArrowUpRight size={18} className="text-red-400" />
    );
  };

  const getTxAmount = (txn: any) => {
    const sym = CURRENCY_CONFIG[txn.currency]?.symbol || txn.currency || '$';
    const amt = parseFloat(txn.amount || 0).toFixed(2);
    const isCredit = txn.type === 'deposit' || txn.type === 'credit';
    return (
      <span className={isCredit ? 'text-green-400' : 'text-red-400'}>
        {isCredit ? '+' : '-'}{sym}{amt}
      </span>
    );
  };

  const formatTxDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };
  const formatReceiptMoney = (amount: number, currency: string) => {
    const c = String(currency || 'USD').toUpperCase();
    const sym = CURRENCY_CONFIG[c]?.symbol;
    const formatted = Number(amount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: ['USDC', 'USDT'].includes(c) ? 6 : 2,
    });
    return sym ? `${sym}${formatted}` : `${formatted} ${c}`;
  };

  // i18n with English fallback. The translation function returns the key
  // verbatim when no entry exists; this wrapper substitutes a default so
  // the new UI ships with sensible copy even for keys that aren't in our
  // strings file yet.
  const tt = (k: string, fb: string) => {
    const v = (t as any)?.(k);
    return (typeof v === 'string' && v && v !== k) ? v : fb;
  };

  // ─── render ──────────────────────────────────────────────────────────────
  // Aesthetic: Mercury / Ramp. Generous whitespace, flat surfaces
  // (no glass blur on inner cards), large display numerals, monospaced money,
  // lime accent ONLY on primary CTAs and active states. AppShell owns header
  // and bottom-nav chrome; Dashboard renders body-only.
  const setupDone = setupSteps.filter(s => s.completed).length;
  const setupTotal = setupSteps.length;
  const greeting   = (() => {
    const h = new Date().getHours();
    if (h < 5)  return tt('dashboard.greet.night',   'Good evening');
    if (h < 12) return tt('dashboard.greet.morning', 'Good morning');
    if (h < 18) return tt('dashboard.greet.afternoon','Good afternoon');
    return        tt('dashboard.greet.evening', 'Good evening');
  })();
  const firstName  = ((userFullName || '').trim().split(/\s+/)[0] || (userEmail || '').split('@')[0] || '').trim();

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      {/* ── HERO ── Revolut-style: identity row + big balance + inline actions
          The hero is a single dark card with a subtle gradient and a lime
          micro-pill carrying the account status. Action buttons are circular
          icon buttons (Add / Send / Receive / Convert) underneath the
          balance — same idiom as Revolut and Wise mobile. */}
      <section className="px-4 sm:px-5 pt-4">
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] px-5 pt-5 pb-6">
          {/* Soft lime aura */}
          <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full bg-[#C7FF00] opacity-[0.06] blur-3xl" />

          {/* Identity row */}
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-white/50 font-medium">
                {greeting}{firstName ? ',' : ''}
              </p>
              {firstName && (
                <p className="text-[13px] font-semibold text-white truncate">{firstName}</p>
              )}
            </div>
            <AccountStatusBadge status={accountStatus} size="sm" />
          </div>

          {/* Balance */}
          <div className="relative mt-5">
            <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-semibold mb-1.5">
              {tt('dashboard.totalBalance', 'Total balance')}
            </p>
            <div className="flex items-end gap-2">
              <h1 className="text-white font-semibold tracking-tight tabular-nums leading-none text-[40px] sm:text-[52px]">
                {balanceHidden ? (
                  <span>••••••</span>
                ) : (
                  <>
                    <span className="text-xl sm:text-2xl text-white/50 mr-1 align-top">$</span>
                    {totalBalance.toFixed(2).split('.')[0]}
                    <span className="text-xl sm:text-2xl text-white/50">
                      .{totalBalance.toFixed(2).split('.')[1]}
                    </span>
                  </>
                )}
              </h1>
              <button
                onClick={() => { const n = !balanceHidden; setBalanceHidden(n); updatePrefs({ hide_balance: n }); }}
                aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
                className="ml-1 mb-1.5 p-1.5 rounded-full hover:bg-white/[0.06] transition-colors"
              >
                {balanceHidden
                  ? <Eye className="w-4 h-4 text-white/50" />
                  : <EyeOff className="w-4 h-4 text-white/50" />}
              </button>
            </div>
            <p className="text-[11px] text-white/40 mt-1.5">
              {accountChipCount > 0
                ? `${tt('dashboard.across', 'Across')} ${accountChipCount} ${accountChipCount === 1 ? 'account' : 'accounts'}`
                : tt('dashboard.empty.subtitle', 'Open your first account to start.')}
            </p>
          </div>

          {/* Circular action buttons (Revolut idiom) */}
          <div className="relative mt-6 grid grid-cols-4 gap-1">
            <HeroAction
              label={tt('nav.cards', 'Cards')}
              Icon={CreditCard}
              primary
              onClick={() => handleNavigate('cards')}
              onHover={() => prefetchScreen('cards')}
            />
            <HeroAction
              label={tt('action.send', 'Send')}
              Icon={ArrowUpRight}
              onClick={() => handleNavigate('send-money')}
              onHover={() => prefetchScreen('send-money')}
            />
            <HeroAction
              label={tt('action.receive', 'Receive')}
              Icon={ArrowDownLeft}
              onClick={() => handleNavigate('receive-money')}
              onHover={() => prefetchScreen('receive-money')}
            />
            <HeroAction
              label={tt('action.exchange', 'Convert')}
              Icon={ArrowLeftRight}
              onClick={() => handleNavigate('exchange')}
              onHover={() => prefetchScreen('exchange')}
            />
          </div>
        </div>
      </section>

      {/* ── 5. Setup checklist (compact, dismissible) ──────────────── */}
      {verificationResolved && accountStatus !== 'active' && !allStepsComplete && !loading && showSetupBanner && (
        <section className="px-5 sm:px-6 mt-6">
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
                <h3 className={`text-sm font-semibold ${tc.text}`}>
                  {tt('dashboard.completeSetup', 'Finish setting up')}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] font-mono ${tc.textMuted} tabular-nums`}>
                  {setupDone} / {setupTotal}
                </span>
                <button onClick={dismissSetupBanner} aria-label="Dismiss" className={`p-1 -mr-1 rounded-full ${tc.hoverBg}`}>
                  <X size={12} className={tc.textMuted} />
                </button>
              </div>
            </div>
            <div className={`w-full h-[3px] ${tc.bgAlt} rounded-full mb-3 overflow-hidden`}>
              <div
                className="h-full bg-[#C7FF00] rounded-full transition-all duration-500"
                style={{ width: `${(setupDone / setupTotal) * 100}%` }}
              />
            </div>
            <ul className="space-y-1">
              {setupSteps.map((step) => (
                <li key={step.id}>
                  <button
                    onClick={() => {
                      if (step.completed || !step.screen) return;
                      if (step.id === 'kyc') {
                        try { sessionStorage.setItem('borderpay_auto_start_verification_v1', '1'); } catch { /* noop */ }
                      }
                      handleNavigate(step.screen);
                    }}
                    disabled={step.completed || !step.screen}
                    className={`w-full flex items-center gap-2.5 py-1.5 rounded-lg transition-colors ${!step.completed && step.screen ? `${tc.hoverBg} cursor-pointer` : 'cursor-default'}`}
                  >
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${step.completed ? 'bg-[#C7FF00]' : tc.bgAlt}`}>
                      {step.completed && (
                        <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-[13px] flex-1 text-left ${step.completed ? `${tc.textMuted} line-through` : tc.text}`}>
                      {step.label}
                    </span>
                    {!step.completed && step.screen && <ChevronRight size={14} className={tc.textMuted} />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── 6. 2FA recommendation (compact) ──────────────────────────
          Gated on `securityLoaded` so the banner never flashes for a user
          who HAS 2FA but whose local cache hasn't been seeded yet. */}
      {isVerified && !has2FA && show2FABanner && !loading && securityLoaded && (
        <section className="px-5 sm:px-6 mt-6">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3.5 flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${tc.text}`}>{tt('auth.2fa.recommend', 'Add 2-factor authentication')}</p>
              <p className={`text-[11px] ${tc.textMuted} mt-0.5`}>{tt('auth.2fa.verifiedOnly', 'Protect your account against takeover.')}</p>
            </div>
            <button
              onClick={() => handleNavigate('two-factor-setup')}
              className="text-[11px] font-bold text-amber-300 hover:text-amber-200 transition-colors flex-shrink-0"
            >
              Enable →
            </button>
            <button onClick={dismiss2FABanner} aria-label="Dismiss" className={`p-1 -mr-1 rounded-full ${tc.hoverBg}`}>
              <X size={12} className={tc.textMuted} />
            </button>
          </div>
        </section>
      )}

      {/* ── ACCOUNTS — horizontal scroll chips (Revolut idiom) ─────────
          Each chip is tap-to-open. Last chip is "Add account". Hidden
          balances render as bullets so the chip width doesn't reflow. */}
      <section className="mt-6">
        <div className="px-4 sm:px-5 flex items-center justify-between mb-3">
          <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>
            {tt('dashboard.wallets', 'Accounts')}
          </h3>
          {accountChipCount > 0 && (
            <button
              onPointerDown={() => prefetchScreen('wallet-detail')}
              onMouseEnter={() => prefetchScreen('wallet-detail')}
              onTouchStart={() => prefetchScreen('wallet-detail')}
              onClick={() => {
                try { sessionStorage.removeItem('borderpay_open_wallet_currency'); } catch { /* noop */ }
                handleNavigate('wallet-detail');
              }}
              className="text-[11px] font-semibold text-[#C7FF00]"
            >
              {tt('dashboard.seeAll', 'See all')}
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
                onClick={() => handleNavigate('add-wallet')}
                className={`flex-shrink-0 w-[200px] rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 text-left ${tc.hoverBg} transition-colors`}
              >
                <div className={`w-8 h-8 rounded-full ${tc.bgAlt} flex items-center justify-center mb-3`}>
                  <Plus className={`w-4 h-4 ${tc.text}`} />
                </div>
                <p className={`text-[13px] font-semibold ${tc.text}`}>
                  {tt('dashboard.addWallet', 'Open your first account')}
                </p>
                <p className={`text-[10px] ${tc.textMuted} mt-0.5`}>
                  USD · EUR · GBP · stablecoins
                </p>
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
                    <DashboardCurrencyIcon currency={w.currency} color={w.color} />
                    <p className={`w-full text-[14px] font-semibold ${tc.text} mt-3 truncate`}>
                      {CURRENCY_LABEL[String(w.currency || '').toUpperCase()] || w.currency}
                    </p>
                    <p className={`w-full text-[18px] font-bold ${tc.text} mt-2 tabular-nums truncate`}>
                      {balanceHidden ? '••••' : formatDashboardWalletBalance(w)}
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
                    <DashboardCurrencyIcon currency={va.currency} color={CURRENCY_CONFIG[va.currency]?.color || '#666'} />
                    <p className={`w-full text-[14px] font-semibold ${tc.text} mt-3 truncate`}>
                      {CURRENCY_LABEL[String(va.currency || '').toUpperCase()] || va.currency}
                    </p>
                  </button>
                ))}
                <button
                  onPointerDown={() => prefetchScreen('add-wallet')}
                  onMouseEnter={() => prefetchScreen('add-wallet')}
                  onTouchStart={() => prefetchScreen('add-wallet')}
                  onClick={() => handleNavigate('add-wallet')}
                  className={`flex-shrink-0 w-[140px] rounded-2xl border border-dashed ${tc.cardBorder} px-4 py-3.5 text-left ${tc.hoverBg} transition-colors flex flex-col items-start`}
                  aria-label={tt('dashboard.addWallet', 'Add account')}
                >
                  <div className={`w-8 h-8 rounded-full ${tc.bgAlt} flex items-center justify-center mb-3`}>
                    <Plus className={`w-4 h-4 ${tc.text}`} />
                  </div>
                  <p className={`text-[11px] ${tc.textMuted} uppercase tracking-wider font-semibold`}>
                    New
                  </p>
                  <p className={`text-[13px] font-semibold ${tc.text} mt-0.5`}>
                    {tt('dashboard.addWallet', 'Add account')}
                  </p>
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── BorderPay infrastructure — single fold-out (Revolut-clean) ──
          We collapsed the previous 5-card stack (KYC + virtual accounts +
          wallets + cards + african-rails) into one entry-point. The cards
          still exist; they live on their own screens reached from here so
          the home stays scannable. The KYC card stays inline only when
          verification is not approved, since it's a call-to-action. */}
      <section className="px-4 sm:px-5 mt-6 space-y-2.5">
        {verificationResolved && !isVerified && (
          <BridgeKycStatusCard userId={userId} onStartVerification={() => handleNavigate('kyc')} />
        )}
        <button
          onPointerDown={() => prefetchScreen('wallet-detail')}
          onMouseEnter={() => prefetchScreen('wallet-detail')}
          onTouchStart={() => prefetchScreen('wallet-detail')}
          onClick={() => handleNavigate('wallet-detail')}
          className={`w-full rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-center gap-3 ${tc.hoverBg} text-left transition-colors`}
        >
          <div className={`w-9 h-9 rounded-full bg-[#C7FF00]/15 flex items-center justify-center flex-shrink-0`}>
            <Coins className="w-4 h-4 text-[#C7FF00]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>
              {tt('dashboard.manageAccounts', 'Manage accounts & wallets')}
            </p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5`}>
              {tt('dashboard.manageAccountsSub', 'Virtual accounts, stablecoin wallets, cards.')}
            </p>
          </div>
          <ChevronRight className={`w-4 h-4 ${tc.textMuted}`} />
        </button>
      </section>

      {/* ── 10. Recent activity — minimal rows ─────────────────────── */}
      <section className="px-5 sm:px-6 mt-7 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>
            {tt('dashboard.recentActivity', 'Recent activity')}
          </h3>
          <button
            onPointerDown={() => prefetchScreen('transactions')}
            onMouseEnter={() => prefetchScreen('transactions')}
            onTouchStart={() => prefetchScreen('transactions')}
            onClick={() => handleNavigate('transactions')}
            className="text-[11px] font-semibold text-[#C7FF00]"
          >
            {tt('dashboard.seeAll', 'See all')}
          </button>
        </div>

        {recentTransactions.length === 0 && !txLoaded ? (
          // Cold load with nothing cached → shape, not spinner.
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`px-4 py-3.5 flex items-center gap-3 ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}>
                <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </div>
        ) : recentTransactions.length === 0 ? (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-5 py-8 text-center`}>
            <Send className={`w-6 h-6 ${tc.textMuted} mx-auto mb-2`} />
            <p className={`text-sm ${tc.text} font-medium`}>{tt('dashboard.noTxYet', 'No activity yet')}</p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5`}>{tt('dashboard.fundWallet', 'Move money to see it here.')}</p>
          </div>
        ) : (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
            {recentTransactions.map((txn, i) => {
              const isCredit = txDirection(txn) === 'credit';
              const sym = CURRENCY_CONFIG[txn.currency]?.symbol || txn.currency || '$';
              const receipt = txn.receipt || normalizeTransactionReceipt({ amount: txn.amount, metadata: txn.metadata });
              const displayAmount = Number(receipt?.finalAmount ?? txn.amount ?? 0);
              const amt = displayAmount.toFixed(2);
              return (
                <div
                  key={txn.id || i}
                  className={`px-4 py-3.5 ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isCredit ? 'bg-emerald-500/10' : tc.bgAlt}`}>
                      {isCredit
                        ? <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
                        : <ArrowUpRight className={`w-3.5 h-3.5 ${tc.text}`} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${tc.text} truncate`}>
                        {sanitizeCustomerFacingText(txn.description || txn.type || 'Transaction')}
                      </p>
                      <div className={`flex items-center gap-2 text-[11px] ${tc.textMuted} mt-0.5`}>
                        <span>{formatTxDate(txn.created_at)}</span>
                        {txn.status === 'pending' && (
                          <span className="px-1.5 py-px rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-semibold uppercase tracking-wider">Pending</span>
                        )}
                        {txn.status === 'failed' && (
                          <span className="px-1.5 py-px rounded-full bg-red-500/15 text-red-400 text-[10px] font-semibold uppercase tracking-wider">Failed</span>
                        )}
                      </div>
                    </div>
                    <p className={`text-sm font-semibold tabular-nums font-mono flex-shrink-0 ${isCredit ? 'text-emerald-400' : tc.text}`}>
                      {isCredit ? '+' : '−'}{sym}{amt}
                    </p>
                  </div>
                  {receipt?.hasFees && (
                    <div className={`ml-11 mt-2 grid grid-cols-2 gap-y-1 text-[11px] ${tc.textMuted}`}>
                      <span>{isCredit ? 'Received' : 'Sent'}</span>
                      <span className="text-right font-mono">{formatReceiptMoney(receipt.initialAmount, txn.currency)}</span>
                      {receipt.developerFeeAmount > 0 && (
                        <>
                          <span>Service fee</span>
                          <span className="text-right font-mono">-{formatReceiptMoney(receipt.developerFeeAmount, txn.currency)}</span>
                        </>
                      )}
                      {receipt.exchangeFeeAmount > 0 && (
                        <>
                          <span>Exchange fee</span>
                          <span className="text-right font-mono">-{formatReceiptMoney(receipt.exchangeFeeAmount, txn.currency)}</span>
                        </>
                      )}
                      <span className={tc.text}>{isCredit ? 'You receive' : 'Net delivered'}</span>
                      <span className={`text-right font-mono ${tc.text}`}>{formatReceiptMoney(receipt.finalAmount, txn.currency)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Exchange rates (below recent activity) ─────────────────── */}
      {FX_NAV_ENABLED && <ExchangeRateWidget onNavigate={handleNavigate} />}

      {/* ── 11. Affiliate banner (footer position) ─────────────────── */}
      <section className="px-5 sm:px-6 mt-6 pb-2">
        <AffiliateBanner kycStatus={verificationResolved && isVerified ? 'verified' : 'pending'} />
      </section>

      {/* Bottom navigation lives in AppShell (mounted by MainApp). */}

      {/* KYC reminder — nudges unverified users to verify (free); opens the
          Identity & KYC screen. Once-per-session; disappears when verified. */}
      <KycReminderPopup
        open={verificationResolved && !isVerified}
        isBusiness={false}
        onVerify={() => handleNavigate('kyc')}
        onClose={() => { /* dismissed for this session inside the popup */ }}
      />
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
  );
}

// ─── Dashboard Live Rate Chart Widget ────────────────────────────────────────

// Platform markup applied to the interbank rate before showing it to the
// end user (2%). Applied uniformly to all pairs so the dashboard matches
// the rate the user will actually receive on the Exchange screen.
const PLATFORM_MARKUP = 0.02;

type RatePair = {
  from: string;
  to: string;
  rate: number;   // marked-up rate (what the customer sees)
  base: number;   // raw interbank rate (used to seed the sparkline)
  change: number; // 24h % change — approximated from daily drift
  vol: number;    // sparkline volatility, scaled to the pair's magnitude
};

function DashboardCurrencyIcon({ currency, color }: { currency: string; color: string }) {
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
      style={{ backgroundColor: `${color}26`, color }}
      aria-hidden
    >
      {code.slice(0, 3)}
    </div>
  );
}

// Major currency pairs (USD / EUR / GBP) surfaced by default. If the live API
// returns these pairs they replace the fallback; if not, the fallback keeps the
// widget populated rather than rendering empty.
const FALLBACK_PAIRS: RatePair[] = [
  { from: 'USD', to: 'EUR', rate: 0.92 * (1 + PLATFORM_MARKUP), base: 0.92, change: +0.12, vol: 0.004 },
  { from: 'USD', to: 'GBP', rate: 0.79 * (1 + PLATFORM_MARKUP), base: 0.79, change: -0.08, vol: 0.003 },
  { from: 'EUR', to: 'GBP', rate: 0.86 * (1 + PLATFORM_MARKUP), base: 0.86, change: +0.04, vol: 0.003 },
];

// ── HeroAction ──────────────────────────────────────────────────────────
// Revolut-style circular icon button used inside the hero card. The primary
// variant uses a solid lime disc; secondary variants use a soft white tint
// so they stay legible against the dark gradient. Label sits beneath.
function HeroAction({
  label, Icon, onClick, onHover, primary, disabled,
}: {
  label:    string;
  Icon:     React.ComponentType<{ className?: string }>;
  onClick:  () => void;
  onHover?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onHover}
      onTouchStart={onHover}
      className="flex flex-col items-center justify-start gap-1.5 py-1 group disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <span
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
          primary
            ? 'bg-[#C7FF00] text-black group-hover:brightness-95'
            : 'bg-white/[0.08] text-white group-hover:bg-white/[0.12]'
        }`}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="text-[11px] font-semibold text-white/80 leading-tight">{label}</span>
    </motion.button>
  );
}

const CORRIDOR_ALLOWLIST = new Set(['EUR', 'GBP']);

// Mulberry32 — deterministic pseudo-random so sparklines stay stable across
// re-renders (previous impl used Math.random which made the lines twitch on
// every state change).
function seededRand(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashPair(from: string, to: string): number {
  let h = 0;
  const s = `${from}/${to}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i);
  return h;
}

function generateSparkData(count: number, base: number, vol: number, seed = 0): number[] {
  const pts: number[] = [];
  const rand = seededRand(seed || Math.floor(Date.now() / 86_400_000));
  let v = base;
  for (let i = 0; i < count; i++) {
    v += (rand() - 0.48) * vol;
    v = Math.max(base * 0.9, Math.min(base * 1.1, v));
    pts.push(v);
  }
  return pts;
}

function DashboardSparkline({ data, positive, width = 100, height = 32 }: { data: number[]; positive: boolean; width?: number; height?: number }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const color = positive ? '#C7FF00' : '#EF4444';
  const gradId = `dsg-${positive ? 'g' : 'r'}-${Math.random().toString(36).slice(2, 6)}`;

  // Fill area
  const firstX = pad;
  const lastX = pad + ((data.length - 1) / (data.length - 1)) * (width - pad * 2);
  const fillPath = `M ${firstX},${height} L ${points.replace(/ /g, ' L ')} L ${lastX},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardRateWidget({ onNavigate }: { onNavigate: (screen: string) => void }) {
  const [selectedPair, setSelectedPair] = useState(0);
  const [pairs, setPairs] = useState<RatePair[]>(FALLBACK_PAIRS);
  const [isLive, setIsLive] = useState(false);

  // Fetch live rates once on mount and apply the platform markup. On any
  // error we silently fall back to the seeded FALLBACK_PAIRS already in
  // state — the widget must never render empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await backendAPI.fx.getLiveRates();
        if (cancelled || !res?.success) return;
        const raw = Array.isArray(res.data) ? res.data : (res.data?.rates || []);
        if (!Array.isArray(raw) || raw.length === 0) return;

        const live: RatePair[] = raw
          .filter((r: any) => r?.source_currency === 'USD' && CORRIDOR_ALLOWLIST.has(r.target_currency))
          .map((r: any) => {
            const base = parseFloat(r.rate);
            if (!Number.isFinite(base) || base <= 0) return null;
            // Volatility ≈ 0.6% of base — small enough that the sparkline
            // reads as a real-world market chart.
            const vol = base * 0.006;
            // Derive a plausible 24h change from the pair hash; range ±1.5%.
            const seed = hashPair('USD', r.target_currency);
            const rand = seededRand(seed)();
            const change = (rand - 0.5) * 3;
            return {
              from: 'USD',
              to: r.target_currency,
              rate: base * (1 + PLATFORM_MARKUP),
              base,
              change,
              vol,
            } as RatePair;
          })
          .filter(Boolean) as RatePair[];

        if (live.length > 0) {
          // Preserve the visual ordering from FALLBACK_PAIRS so the layout
          // stays stable when rates come back.
          const order = ['EUR', 'GBP'];
          live.sort((a, b) => order.indexOf(a.to) - order.indexOf(b.to));
          setPairs(live);
          setIsLive(true);
        }
      } catch {
        // fall back silently
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Clamp selected index if the live set has fewer pairs than the fallback.
  const safeSelected = Math.min(selectedPair, pairs.length - 1);
  const pair = pairs[safeSelected];

  // Generate chart data for the selected pair (30 points)
  const chartData = useMemo(() => {
    return generateSparkData(30, pair.base, pair.vol, hashPair(pair.from, pair.to));
  }, [pair.from, pair.to, pair.base, pair.vol]);

  const isPositive = pair.change >= 0;

  // Generate mini sparklines for rate rows (stable per render)
  const miniCharts = useMemo(() =>
    pairs.map(p => generateSparkData(20, p.base, p.vol, hashPair(p.from, p.to))),
  [pairs]);

  // Big chart SVG
  const chartW = 320;
  const chartH = 100;
  const min = Math.min(...chartData);
  const max = Math.max(...chartData);
  const range = max - min || 1;

  const linePoints = chartData
    .map((v, i) => {
      const x = (i / (chartData.length - 1)) * chartW;
      const y = 6 + (1 - (v - min) / range) * (chartH - 12);
      return `${x},${y}`;
    })
    .join(' ');

  const color = isPositive ? '#C7FF00' : '#EF4444';
  const fillPath = `M 0,${chartH} L ${linePoints.replace(/ /g, ' L ')} L ${chartW},${chartH} Z`;

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#C7FF00]" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Exchange Activity</span>
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#C7FF00] uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF00] animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={() => onNavigate('exchange')}
          className="text-[10px] text-[#C7FF00] font-semibold flex items-center gap-1"
        >
          Trade <ChevronRight size={12} />
        </button>
      </div>

      {/* Selected Pair Info */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-lg font-bold text-white">{pair.from}/{pair.to}</span>
            <span className="text-sm text-gray-400 ml-2">{pair.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
            isPositive ? 'bg-[#C7FF00]/10 text-[#C7FF00]' : 'bg-red-500/10 text-red-400'
          }`}>
            {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {isPositive ? '+' : ''}{pair.change.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="px-4 pb-3">
        <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" className="rounded-lg">
          <defs>
            <linearGradient id="dashChartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fillPath} fill="url(#dashChartGrad)" />
          <polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Current value dot */}
          {(() => {
            const lastIdx = chartData.length - 1;
            const cx = (lastIdx / (chartData.length - 1)) * chartW;
            const cy = 6 + (1 - (chartData[lastIdx] - min) / range) * (chartH - 12);
            return (
              <>
                <circle cx={cx} cy={cy} r="4" fill={color} opacity="0.3" />
                <circle cx={cx} cy={cy} r="2.5" fill={color} />
              </>
            );
          })()}
        </svg>
      </div>

      {/* Rate Rows */}
      <div className="border-t border-white/[0.04]">
        {pairs.map((p, i) => {
          const pos = p.change >= 0;
          return (
            <button
              key={`${p.from}-${p.to}`}
              onClick={() => setSelectedPair(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
                i === safeSelected ? 'bg-[#C7FF00]/[0.06]' : 'hover:bg-white/[0.02]'
              } ${i < pairs.length - 1 ? 'border-b border-white/[0.03]' : ''}`}
            >
              {/* Pair label */}
              <div className="w-[70px] text-left">
                <span className={`text-[11px] font-bold ${i === safeSelected ? 'text-[#C7FF00]' : 'text-white'}`}>
                  {p.from}/{p.to}
                </span>
              </div>

              {/* Mini sparkline */}
              <div className="flex-1">
                <DashboardSparkline data={miniCharts[i]} positive={pos} width={80} height={24} />
              </div>

              {/* Rate + change */}
              <div className="text-right">
                <p className="text-[11px] font-semibold text-white">
                  {p.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`text-[9px] font-bold ${pos ? 'text-[#C7FF00]' : 'text-red-400'}`}>
                  {pos ? '+' : ''}{p.change.toFixed(2)}%
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
