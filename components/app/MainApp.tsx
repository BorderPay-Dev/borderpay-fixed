/**
 * BorderPay Africa - Main App Container
 * Handles navigation between all app screens after authentication.
 *
 * Performance:
 *   - Every non-Dashboard screen is loaded via React.lazy() so the initial
 *     dashboard ships with a small bundle.
 *   - Suspense fallback is a transparent skeleton, NEVER a loading spinner.
 *   - `prefetchScreen()` is exposed so Dashboard / nav buttons can warm a
 *     screen's chunk on hover/touchstart, making the click feel instant.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { Dashboard } from './Dashboard';
import { BusinessDashboard } from '../business/BusinessDashboard';
import { KYCVerification } from '../kyc/KYCVerification';
import { TransactionsScreen } from '../transactions/TransactionsScreen';
import { WalletScreen } from '../wallet/WalletScreen';
import { AddWalletScreen } from '../wallet/AddWalletScreen';
import { ReceiveMoneyScreen } from '../receive/ReceiveMoneyScreen';
import { ExternalWalletsScreen } from '../wallets/ExternalWalletsScreen';
import { ExchangeScreen } from '../exchange/ExchangeScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { ProfileScreen } from '../profile/ProfileScreen';
import { NotificationsScreen } from '../notifications/NotificationsScreen';
import { TeamScreen } from '../team/TeamScreen';
import { ExternalAccountsScreen } from '../payouts/ExternalAccountsScreen';
import { TwoFactorSetup } from '../security/TwoFactorSetup';
import { BiometricSetup } from '../security/BiometricSetup';
import { ChangePIN } from '../settings/ChangePIN';
import { ChangePassword } from '../settings/ChangePassword';
import { TermsOfServiceScreen } from '../legal/TermsOfServiceScreen';
import { PrivacyPolicyScreen } from '../legal/PrivacyPolicyScreen';
import { PreferencesScreen } from './PreferencesScreen';
import { CountryEligibilityScreen } from '../compliance/CountryEligibilityScreen';
import { HelpCenterScreen } from '../settings/HelpCenterScreen';
import { SupportScreen } from '../settings/SupportScreen';
import { CardsScreen } from '../cards/CardsScreen';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { AppShell, type AppRoute } from '../shell/AppShell';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import {
  TRANSFERS_LIVE,
  EXTERNAL_ACCOUNTS_LIVE,
  PAYROLL_NAV_ENABLED,
  PAYROLL_RUNTIME_ENABLED,
} from '../../utils/featureFlags';
import { TransfersComingSoonScreen } from '../send/TransfersComingSoonScreen';
import { PayrollComingSoonScreen } from '../business/PayrollComingSoonScreen';
import {
  navPerfGetReport,
  navPerfMarkFirstPaint,
  navPerfMarkRouteMounted,
  navPerfReset,
  navPerfStartRoute,
} from '../../utils/performance/navigationPerf';

// ─── Lazy-loaded screens ──────────────────────────────────────────────
// Each loader is exported via `prefetchers` so that hover/touchstart on a
// nav button can pre-warm the chunk before the click fires.
const lazyImport = <T extends { default: React.ComponentType<any> }>(
  loader: () => Promise<T>
) => {
  const resilientLoader = async () => {
    try {
      return await loader();
    } catch (error: any) {
      const msg = String(error?.message || error || '').toLowerCase();
      const isModuleLoadFailure =
        msg.includes('importing a module script failed') ||
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('dynamically imported module') ||
        msg.includes('chunkloaderror') ||
        msg.includes('loading chunk');

      if (isModuleLoadFailure && typeof window !== 'undefined') {
        const reloadKey = 'borderpay_module_reload_once_v1';
        let alreadyRetried = false;
        try {
          alreadyRetried = sessionStorage.getItem(reloadKey) === '1';
        } catch {
          alreadyRetried = false;
        }

        if (!alreadyRetried) {
          try { sessionStorage.setItem(reloadKey, '1'); } catch { /* noop */ }
          const url = new URL(window.location.href);
          url.searchParams.set('hard_refresh', String(Date.now()));
          window.location.replace(url.toString());
          await new Promise<never>(() => { /* wait for navigation */ });
        }
      }

      throw error;
    }
  };

  const Component = lazy(resilientLoader);
  (Component as any).preload = resilientLoader;
  return Component;
};

const PINSetup = lazyImport(() => import('../security/PINSetup').then(m => ({ default: m.PINSetup })));
const SendMoneyFlow = lazyImport(() => import('../send/SendMoneyFlow').then(m => ({ default: m.SendMoneyFlow })));
const BulkPayoutScreen = lazyImport(() => import('../business/BulkPayoutScreen').then(m => ({ default: m.BulkPayoutScreen })));
const PayrollScreen = lazyImport(() => import('../business/PayrollScreen').then(m => ({ default: m.PayrollScreen })));
const AddExternalAccountScreen = lazyImport(() => import('../payouts/AddExternalAccountScreen').then(m => ({ default: m.AddExternalAccountScreen })));
const eagerPreload = () => Promise.resolve();

// Map of screen → preload function. Exposed on `window.__borderpay_prefetch`
// so any nav button can call it on hover/touchstart.
const SCREEN_PRELOADERS: Record<string, () => Promise<unknown>> = {
  cards: eagerPreload,
  'send-money': (SendMoneyFlow as any).preload,
  'receive-money': eagerPreload,
  exchange: eagerPreload,
  'two-factor-setup': eagerPreload,
  'pin-setup': (PINSetup as any).preload,
  'biometric-setup': eagerPreload,
  kyc: eagerPreload,
  transactions: eagerPreload,
  'wallet-detail': eagerPreload,
  'add-wallet': eagerPreload,
  settings: eagerPreload,
  profile: eagerPreload,
  'change-pin': eagerPreload,
  'change-password': eagerPreload,
  'country-eligibility': eagerPreload,
  'terms-of-service': eagerPreload,
  'privacy-policy': eagerPreload,
  preferences: eagerPreload,
  'help-center': eagerPreload,
  support: eagerPreload,
  team:          eagerPreload,
  notifications: eagerPreload,
  'external-accounts':   eagerPreload,
  'external-wallets':    eagerPreload,
  'bulk-payout':         (BulkPayoutScreen as any).preload,
  payroll:              (PayrollScreen as any).preload,
  'add-external-account': (AddExternalAccountScreen as any).preload,
};

export function prefetchScreen(name: string) {
  const fn = SCREEN_PRELOADERS[name];
  if (fn) { try { fn(); } catch { /* silent */ } }
}

if (typeof window !== 'undefined') {
  (window as any).__borderpay_prefetch = prefetchScreen;
}

function canonicalizeScreen(screen: AppScreen | string): AppScreen {
  switch (String(screen || '').trim()) {
    case 'ramps':
      // Legacy hidden route alias → live receive surface.
      return 'receive-money';
    case 'wallet':
      return 'wallet-detail';
    case 'send':
      return 'send-money';
    case 'receive':
      return 'receive-money';
    case 'home':
      return 'dashboard';
    case 'dashboard':
    case 'cards':
    case 'send-money':
    case 'receive-money':
    case 'exchange':
    case 'transactions':
    case 'wallet-detail':
    case 'two-factor-setup':
    case 'pin-setup':
    case 'change-pin':
    case 'change-password':
    case 'country-eligibility':
    case 'kyc':
    case 'settings':
    case 'profile':
    case 'terms-of-service':
    case 'privacy-policy':
    case 'preferences':
    case 'biometric-setup':
    case 'help-center':
    case 'support':
    case 'team':
    case 'notifications':
    case 'external-accounts':
    case 'external-wallets':
    case 'bulk-payout':
    case 'payroll':
    case 'add-external-account':
    case 'add-wallet':
      return screen as AppScreen;
    default:
      return 'dashboard';
  }
}

function getBusinessDisplayName(profile: any): string {
  const businessName = profile?.account_type === 'business' ? (profile?.company_name || 'Business account') : '';
  if (businessName) return businessName;
  if (profile?.account_type === 'business') {
    if (profile?.company_name) return profile.company_name;
    try {
      const uid = String(profile?.id || '').trim();
      if (uid) {
        const cachedBizName = String(localStorage.getItem(`borderpay_business_name_v1:${uid}`) || '').trim();
        if (cachedBizName) return cachedBizName;
      }
    } catch { /* ignore */ }
    try {
      const authUser = authAPI.getStoredUser();
      const authId = String(authUser?.id || '').trim();
      if (authId) {
        const cachedBizName = String(localStorage.getItem(`borderpay_business_name_v1:${authId}`) || '').trim();
        if (cachedBizName) return cachedBizName;
      }
      if (authUser?.company_name) return String(authUser.company_name);
    } catch { /* ignore */ }
    return 'Business account';
  }
  if (profile?.full_name) return profile.full_name;
  if (profile?.email) return String(profile.email).split('@')[0] || 'User';
  try {
    const authUser = authAPI.getStoredUser();
    const metaName = authUser?.user_metadata?.full_name || authUser?.full_name;
    if (metaName) return String(metaName);
    if (authUser?.email) return String(authUser.email).split('@')[0] || 'User';
  } catch { /* ignore */ }
  return 'User';
}

function hasBusinessAccountCached(): boolean {
  try {
    const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    if (String(cached?.account_type || '').toLowerCase() === 'business') return true;
    const cachedId = String(cached?.id || '').trim();
    if (cachedId) {
      const bizName = String(localStorage.getItem(`borderpay_business_name_v1:${cachedId}`) || '').trim();
      if (bizName) return true;
    }
  } catch { /* noop */ }
  try {
    const authUser = authAPI.getStoredUser();
    if (String(authUser?.account_type || '').toLowerCase() === 'business') return true;
    const authId = String(authUser?.id || '').trim();
    if (authId) {
      const bizName = String(localStorage.getItem(`borderpay_business_name_v1:${authId}`) || '').trim();
      if (bizName) return true;
    }
    const metaCompany = String(authUser?.user_metadata?.company_name || '').trim();
    if (metaCompany) return true;
  } catch { /* noop */ }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      const meta = (parsed?.user || parsed?.currentSession?.user)?.user_metadata || {};
      if (String(meta?.account_type || '').toLowerCase() === 'business') return true;
      if (String(meta?.company_name || '').trim()) return true;
    }
  } catch { /* noop */ }
  return false;
}

function unreadCountCacheKey(userId: string): string {
  return `borderpay_unread_count:${userId}`;
}

function readCachedUnreadCount(userId: string): number {
  try {
    const raw = localStorage.getItem(unreadCountCacheKey(userId));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeCachedUnreadCount(userId: string, count: number): void {
  try {
    localStorage.setItem(unreadCountCacheKey(userId), String(Math.max(0, Math.floor(count || 0))));
  } catch { /* ignore notification cache write */ }
}

const SHELL_SYNC_COOLDOWN_MS = 45_000;

function shouldRunShellSync(userId: string, channel: 'profile' | 'unread'): boolean {
  try {
    const key = `borderpay_shell_sync_v1:${channel}:${userId}`;
    const now = Date.now();
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Number.isFinite(last) && now - last < SHELL_SYNC_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(key, String(now));
    return true;
  } catch {
    return true;
  }
}

// ─── Skeleton Fallback (no spinner!) ───────────────────────────────────
// Shown only on the first navigation to a screen, while its chunk loads.
// Subsequent navigations to the same screen render instantly.
function ScreenSkeleton() {
  return (
    <div className="min-h-[100dvh] w-full" aria-busy="true">
      <div className="h-14 w-full" />
      <div className="px-5 space-y-3 mt-4">
        <div className="h-4 w-32 rounded bg-white/[0.04]" />
        <div className="h-24 rounded-2xl bg-white/[0.03]" />
        <div className="h-24 rounded-2xl bg-white/[0.03]" />
        <div className="h-24 rounded-2xl bg-white/[0.03]" />
      </div>
    </div>
  );
}

interface MainAppProps {
  userId: string;
  onLogout: () => void;
  onLock?: () => void;
  newDeviceDetected?: boolean;
  onDismissNewDevice?: () => void;
  onTrustDevice?: () => void;
}

export type AppScreen =
  | 'dashboard'
  | 'home'
  | 'ramps'
  | 'cards'
  | 'send-money'
  | 'receive-money'
  | 'exchange'
  | 'transactions'
  | 'wallet-detail'
  | 'add-wallet'
  | 'two-factor-setup'
  | 'pin-setup'
  | 'change-pin'
  | 'change-password'
  | 'country-eligibility'
  | 'kyc'
  | 'settings'
  | 'profile'
  | 'terms-of-service'
  | 'privacy-policy'
  | 'preferences'
  | 'biometric-setup'
  | 'help-center'
  | 'support'
  | 'team'
  | 'notifications'
  | 'external-accounts'
  | 'external-wallets'
  | 'bulk-payout'
  | 'payroll'
  | 'add-external-account';

// ── AppShell ↔ MainApp routing bridge ──────────────────────────────────
// The shell speaks `AppRoute` (Home/Send/Receive/Account + drawer items).
// MainApp's internal screen graph is finer-grained (`AppScreen`). These
// helpers translate between the two so the shell is presentational and
// MainApp keeps full control of sub-flow routing.

const TOP_LEVEL_SCREENS: ReadonlySet<AppScreen> = new Set([
  'dashboard', 'home', 'wallet-detail', 'transactions',
  'cards', 'profile', 'settings', 'kyc', 'team', 'notifications',
]);

const SHELL_TO_SCREEN: Record<AppRoute, AppScreen> = {
  dashboard:     'dashboard',
  send:          'send-money',
  receive:       'receive-money',
  account:       'profile',
  cards:         'cards',
  wallet:        'wallet-detail',
  transactions:  'transactions',
  kyc:           'kyc',
  settings:      'settings',
  notifications: 'notifications',
  team:          'team',
};

function screenToShellRoute(s: AppScreen): AppRoute {
  switch (s) {
    case 'dashboard':
    case 'home':           return 'dashboard';
    case 'send-money':     return 'send';
    case 'receive-money':  return 'receive';
    case 'profile':        return 'account';
    case 'wallet-detail':  return 'wallet';
    case 'transactions':   return 'transactions';
    case 'cards':          return 'cards';
    case 'kyc':            return 'kyc';
    case 'settings':       return 'settings';
    case 'team':           return 'team';
    case 'notifications':  return 'notifications';
    default:               return 'dashboard';
  }
}

type StablecoinConfirmData = {
  txType: 'deposit' | 'send' | 'receive' | 'swap';
  currency: 'USDC' | 'USDT' | 'PYUSD' | 'USDB';
  amount?: number;
  network?: string;
  address?: string;
  txHash?: string;
};

export function MainApp({ userId, onLogout, onLock, newDeviceDetected, onDismissNewDevice, onTrustDevice }: MainAppProps) {
  const initialScreenFromCallback = useMemo<AppScreen>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('screen') === 'kyc') return 'kyc';
      const postCallback = sessionStorage.getItem('borderpay_post_callback_screen');
      if (postCallback === 'kyc') return 'kyc';
    } catch { /* noop */ }
    return 'dashboard';
  }, []);
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(initialScreenFromCallback);
  const [navigationStack, setNavigationStack] = useState<AppScreen[]>(
    initialScreenFromCallback === 'dashboard'
      ? ['dashboard']
      : ['dashboard', initialScreenFromCallback],
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const tc = useThemeClasses();
  const tl = useThemeLanguage();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const detailSheetIdsRef = useRef<Set<string>>(new Set());
  const [stablecoinConfirmData, setStablecoinConfirmData] = useState<StablecoinConfirmData | null>(null);
  const [verificationEmbedOpen, setVerificationEmbedOpen] = useState<boolean>(() => {
    try { return sessionStorage.getItem('borderpay_verification_embed_open') === '1'; } catch { return false; }
  });
  const [verificationEmbedTitle, setVerificationEmbedTitle] = useState<string>(() => {
    try { return sessionStorage.getItem('borderpay_verification_embed_title') || ''; } catch { return ''; }
  });
  const [verificationEmbedReturnEnabled, setVerificationEmbedReturnEnabled] = useState<boolean>(() => {
    try { return sessionStorage.getItem('borderpay_verification_embed_return_enabled') !== '0'; } catch { return true; }
  });
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  // Clear one-time module-reload fuse once the app boots successfully.
  useEffect(() => {
    try { sessionStorage.removeItem('borderpay_module_reload_once_v1'); } catch { /* noop */ }
  }, []);

  // ─── Shell display props (avatar / name / unread bell badge) ───────────
  // Hydrated from cache for first paint, then refreshed by the
  // get-profile + notifications calls below.
  const [shellUserName, setShellUserName] = useState<string>(() => {
    try {
      const directBusinessName = String(localStorage.getItem(`borderpay_business_name_v1:${userId}`) || '').trim();
      const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
      if (directBusinessName) {
        return directBusinessName;
      }
      const inferredBusiness =
        String(cached?.account_type || '').toLowerCase() === 'business' || hasBusinessAccountCached();
      return getBusinessDisplayName({
        ...cached,
        account_type: inferredBusiness ? 'business' : (cached?.account_type || 'individual'),
      });
    } catch {
      return hasBusinessAccountCached() ? 'Business account' : 'User';
    }
  });
  const [shellAvatarUrl, setShellAvatarUrl] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_user') || '{}')?.profile_picture_url || null; } catch { return null; }
  });
  const [unreadCount, setUnreadCount] = useState<number>(() => readCachedUnreadCount(userId));

  const updateUnreadCount = useCallback((count: number) => {
    const next = Math.max(0, Math.floor(Number(count) || 0));
    setUnreadCount(next);
    writeCachedUnreadCount(userId, next);
  }, [userId]);

  // ─── ADDITIVE: account-type routing ────────────────────────────────────
  // Default to 'individual' for first paint (preserves existing behaviour
  // for the 100% of users that ARE individual). Background-refresh from
  // user_profiles to flip to 'business' if the user is a business account.
  const [accountType, setAccountType] = useState<'individual' | 'business'>(() => {
    try {
      const directBusinessName = String(localStorage.getItem(`borderpay_business_name_v1:${userId}`) || '').trim();
      if (directBusinessName) return 'business';
      const cached = JSON.parse(localStorage.getItem('borderpay_user') || 'null');
      if (cached?.account_type === 'business') return 'business';
      if (cached?.account_type === 'individual') return 'individual';
      const authUser = authAPI.getStoredUser();
      if (authUser?.account_type === 'business') return 'business';
      if (authUser?.account_type === 'individual') return 'individual';
      // Fallback: the cached profile may not carry account_type yet (e.g. when
      // get-user-profile omitted it). Read it synchronously from the Supabase
      // auth-token metadata (set at signup) so business users don't first-paint
      // the individual dashboard and then flip.
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
        const p = JSON.parse(localStorage.getItem(k) || 'null');
        const meta = (p?.user || p?.currentSession?.user)?.user_metadata || {};
        if (meta.account_type === 'business') return 'business';
      }
    } catch { /* fall through */ }
    return 'individual';
  });

  useEffect(() => {
    let cancelled = false;
    let syncInFlight = false;
    const syncProfile = async (force = false) => {
      if (syncInFlight) return;
      if (!force && !shouldRunShellSync(userId, 'profile')) return;
      syncInFlight = true;
      try {
        const r = await backendAPI.user.getProfile();
        if (cancelled) return;
        if (r?.success && r.data?.user) {
          const u: any = r.data.user;
          let cached: any = {};
          try { cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}'); } catch { cached = {}; }
          const cachedBusinessName = String(localStorage.getItem(`borderpay_business_name_v1:${userId}`) || '').trim();
          let hasBusinessSignal =
            u.account_type === 'business' ||
            String(cached?.account_type || '').toLowerCase() === 'business' ||
            String(cached?.company_name || '').trim().length > 0 ||
            cachedBusinessName.length > 0;
          if (!hasBusinessSignal) {
            try {
              const roster = await backendAPI.team.list();
              if (roster?.success && roster.data?.business_user_id) {
                hasBusinessSignal = true;
                const company_name = String((roster.data as any)?.company_name || '').trim();
                if (company_name) {
                  u.company_name = company_name;
                  try {
                    localStorage.setItem(`borderpay_business_name_v1:${userId}`, company_name);
                  } catch { /* noop */ }
                }
              }
            } catch { /* individual account or offline */ }
          }
          const t: 'individual' | 'business' = hasBusinessSignal ? 'business' : 'individual';
          if (t === 'business' && !u.company_name && cached?.company_name) {
            u.company_name = cached.company_name;
          }
          if (t === 'business' && !u.company_name && cachedBusinessName) {
            u.company_name = cachedBusinessName;
          }
          const displayName = getBusinessDisplayName({ ...u, account_type: t });
          if (displayName && displayName !== shellUserName) setShellUserName(displayName);
          // Business fast-paint hardening: if profile payload omits company_name,
          // pull it from business profile once and cache it for subsequent shells.
          if (t === 'business' && !u.company_name) {
            try {
              const biz = await backendAPI.business.getProfile();
              if (biz?.data?.company_name) {
                const company_name = biz.data.company_name;
                u.company_name = company_name;
                setShellUserName(company_name);
                try {
                  const latest = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
                  localStorage.setItem('borderpay_user', JSON.stringify({ ...latest, account_type: 'business', company_name }));
                  localStorage.setItem(`borderpay_business_name_v1:${userId}`, company_name);
                } catch { /* noop */ }
              }
            } catch { /* noop */ }
          }
          if (t !== accountType) setAccountType(t);
          // Shell display props — kept in MainApp so AppShell stays presentational.
          const nextDisplayName = getBusinessDisplayName({ ...u, account_type: t });
          if (nextDisplayName && nextDisplayName !== shellUserName) setShellUserName(nextDisplayName);
          if (u.profile_picture_url !== undefined && u.profile_picture_url !== shellAvatarUrl) {
            setShellAvatarUrl(u.profile_picture_url || null);
          }
          // Update cache so other screens reading from localStorage are in sync.
          try {
            localStorage.setItem('borderpay_user', JSON.stringify({ ...cached, ...u, account_type: t }));
          } catch { /* ignore */ }
        }
      } catch { /* keep cached */ }
      finally { syncInFlight = false; }
    };
    void syncProfile(true);
    const onFocus = () => { void syncProfile(false); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncProfile(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ─── Shell snapshot ───────────────────────────────────────────────────────
  // Route-level screens own their own data caches; shell only hydrates the
  // tiny values it actually needs for first-navigation responsiveness.
  useEffect(() => {
    let cancelled = false;
    let syncInFlight = false;
    const syncUnread = async (force = false) => {
      if (syncInFlight) return;
      if (!force && !shouldRunShellSync(userId, 'unread')) return;
      syncInFlight = true;
      try {
        const unreadRes = await backendAPI.notifications.getUnreadCount();
        if (cancelled) return;

        if (unreadRes?.success) {
          const n = Number((unreadRes as any)?.data?.notifications_unread_count ?? 0);
          if (Number.isFinite(n)) updateUnreadCount(n);
        }
      } catch { /* non-fatal */ }
      finally { syncInFlight = false; }
    };
    void syncUnread(true);
    const onFocus = () => { void syncUnread(false); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncUnread(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, accountType, refreshKey, updateUnreadCount]);

  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, []);

  const navigateTo = (screen: AppScreen | string) => {
    const target = canonicalizeScreen(screen);
    const isAlreadyHere =
      currentScreen === target ||
      (target === 'home' && currentScreen === 'dashboard') ||
      (target === 'dashboard' && currentScreen === 'home');

    if (isAlreadyHere) return;

    // Pre-warm the chunk in case the user reached this state without a
    // hover preload (e.g. programmatic nav)
    prefetchScreen(target);
    navPerfStartRoute(target, accountType);
    setCurrentScreen(target);
    setNavigationStack(prev => [...prev, target]);
    scrollToTop();
  };

  React.useEffect(() => {
    (window as any).__borderpay_navigate = navigateTo;
    (window as any).__borderpay_nav_perf_report = navPerfGetReport;
    (window as any).__borderpay_nav_perf_reset = navPerfReset;
    return () => {
      delete (window as any).__borderpay_navigate;
      delete (window as any).__borderpay_nav_perf_report;
      delete (window as any).__borderpay_nav_perf_reset;
    };
  });

  useEffect(() => {
    navPerfMarkRouteMounted(currentScreen);
    const raf = window.requestAnimationFrame(() => navPerfMarkFirstPaint(currentScreen));
    return () => window.cancelAnimationFrame(raf);
  }, [currentScreen]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ open?: boolean; title?: string; returnEnabled?: boolean }>;
      const open = Boolean(ce?.detail?.open);
      const title = String(ce?.detail?.title || '');
      const returnEnabled = ce?.detail?.returnEnabled !== false;
      setVerificationEmbedOpen(open);
      setVerificationEmbedTitle(title);
      setVerificationEmbedReturnEnabled(returnEnabled);
      try {
        if (open) {
          sessionStorage.setItem('borderpay_verification_embed_open', '1');
          sessionStorage.setItem('borderpay_verification_embed_title', title);
          sessionStorage.setItem('borderpay_verification_embed_return_enabled', returnEnabled ? '1' : '0');
        } else {
          sessionStorage.removeItem('borderpay_verification_embed_open');
          sessionStorage.removeItem('borderpay_verification_embed_title');
          sessionStorage.removeItem('borderpay_verification_embed_return_enabled');
        }
      } catch { /* noop */ }
    };
    window.addEventListener('borderpay:verification_embed_visibility', handler as EventListener);
    return () => window.removeEventListener('borderpay:verification_embed_visibility', handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ open?: boolean; id?: string }>;
      const id = ce?.detail?.id;
      if (id) {
        if (ce.detail.open) detailSheetIdsRef.current.add(id);
        else detailSheetIdsRef.current.delete(id);
        setDetailSheetOpen(detailSheetIdsRef.current.size > 0);
        return;
      }
      detailSheetIdsRef.current.clear();
      setDetailSheetOpen(Boolean(ce?.detail?.open));
    };
    window.addEventListener('borderpay:wallet_detail_sheet_visibility', handler as EventListener);
    return () => window.removeEventListener('borderpay:wallet_detail_sheet_visibility', handler as EventListener);
  }, []);

  // Hosted verification callback deep-link:
  // Bridge returns to `/?screen=kyc`. Honor that route directly so users
  // land back on verification instead of dashboard.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const screenParam = params.get('screen');
      const marker = sessionStorage.getItem('borderpay_post_callback_screen');
      if (!screenParam && marker !== 'kyc') return;
      const target = canonicalizeScreen(screenParam || marker || 'dashboard');
      if (target !== currentScreen) {
        setCurrentScreen(target);
        setNavigationStack(target === 'dashboard' ? ['dashboard'] : ['dashboard', target]);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('screen');
      url.searchParams.delete('skip_splash');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      sessionStorage.removeItem('borderpay_post_callback_screen');
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefetch most-likely-next screens once the dashboard is mounted, so the
  // user's first navigation is instant. Runs once per session, in background.
  React.useEffect(() => {
    let cancelled = false;
    const prewarmKey = `borderpay_mainapp_route_prewarm_v1:${userId}:${accountType}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (Number.isFinite(last) && Date.now() - last < 180_000) return () => { cancelled = true; };
      sessionStorage.setItem(prewarmKey, String(Date.now()));
    } catch { /* noop */ }
    const idle = (cb: () => void) => {
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(cb, { timeout: 1500 });
      else setTimeout(cb, 800);
    };
    idle(() => {
      if (cancelled) return;
      // Keep runtime light: warm only highest-traffic routes. Other screens are
      // prefetched on intent (tap/hover) via AppShell/route controls.
      ['wallet-detail', 'receive-money', 'send-money', 'transactions', 'notifications', 'profile']
        .forEach(prefetchScreen);
      if (hasBusinessAccountCached() || accountType === 'business') {
        ['team', 'external-accounts', 'bulk-payout', 'payroll'].forEach(prefetchScreen);
      }
    });
    return () => { cancelled = true; };
  }, [accountType, userId]);

  // Warm shared financial route data in the background so first opens of
  // Wallet / Receive / Transactions / External Accounts render from cache.
  React.useEffect(() => {
    let cancelled = false;
    const warmTsKey = financialCacheKey('borderpay_financial_warm_ts_v1', { userId });
    const walletsKey = financialCacheKey('borderpay_wallets_v1', { userId });
    const vaKey = financialCacheKey('borderpay_va_v1', { userId });
    const txKey = financialCacheKey('borderpay_tx_history_v1', { userId });
    const extKey = financialCacheKey('borderpay_payout_accounts_v1', { userId });
    const warm = async () => {
      // Avoid re-running heavy warm fan-out on every app resume / quick session
      // re-entry. Route screens now own their own revalidation throttles.
      try {
        const last = Number(localStorage.getItem(warmTsKey) || '0');
        if (Number.isFinite(last) && Date.now() - last < 5 * 60_000) return;
      } catch { /* noop */ }

      try {
        const hasWalletCache = (() => {
          try {
            return !!localStorage.getItem(walletsKey) || !!localStorage.getItem(vaKey);
          } catch { return false; }
        })();
        if (!hasWalletCache) {
          const walletRoute: any = await backendAPI.financial.getWalletRouteData();
          if (!cancelled && walletRoute?.success) {
            const data = walletRoute?.data || {};
            try { localStorage.setItem(walletsKey, JSON.stringify(Array.isArray(data?.stablecoin_wallets) ? data.stablecoin_wallets : [])); } catch {}
            try { localStorage.setItem(vaKey, JSON.stringify(Array.isArray(data?.virtual_accounts) ? data.virtual_accounts : [])); } catch {}
            const rows: any[] = Array.isArray(data?.wallets) ? data.wallets : [];
            if (rows.length > 0) {
              const mapped = rows.reduce((acc: Record<string, number>, w: any) => {
                const c = String(w?.currency || '').toUpperCase();
                if (!c) return acc;
                acc[c] = Number(w?.balance || 0);
                return acc;
              }, {});
              try { localStorage.setItem(`borderpay_wallet_balances_${userId}`, JSON.stringify(mapped)); } catch {}
              try {
                const total = rows.reduce((s: number, w: any) => s + Number(w?.balance || 0), 0);
                localStorage.setItem(`borderpay_wallet_total_${userId}`, String(total));
              } catch {}
            }
          }
        }
      } catch {}

      try {
        const hasTxCache = (() => {
          try { return !!localStorage.getItem(txKey); } catch { return false; }
        })();
        if (!hasTxCache) {
          const txRes: any = await backendAPI.transactions.getTransactions(100, 0);
          if (!cancelled && txRes?.success) {
            const txRows = Array.isArray(txRes?.data?.transactions) ? txRes.data.transactions : [];
            try { localStorage.setItem(txKey, JSON.stringify(txRows)); } catch {}
          }
        }
      } catch {}

      try {
        const hasExternalCache = (() => {
          try { return !!localStorage.getItem(extKey); } catch { return false; }
        })();
        if (!hasExternalCache) {
          const extRes: any = await backendAPI.bridge.externalAccount.list();
          if (!cancelled && extRes?.success) {
            const extRows = Array.isArray(extRes?.data?.external_accounts) ? extRes.data.external_accounts : [];
            const normalized = extRows.map((row: any, idx: number) => {
              const rawType = String(row?.account_type || '').toLowerCase();
              const accountType =
                rawType === 'iban' || rawType === 'clabe' || rawType === 'pix' ? rawType : 'us';
              const rawCurrency = String(row?.currency || '');
              const currency = rawCurrency
                ? rawCurrency.toUpperCase()
                : (accountType === 'iban' ? 'EUR' : accountType === 'clabe' ? 'MXN' : accountType === 'pix' ? 'BRL' : 'USD');
              const externalId = String(row?.bridge_external_account_id || row?.external_account_id || row?.id || '');
              const last4 = row?.last_4 || row?.account?.last_4 || row?.iban?.last_4 || row?.clabe?.last_4 || row?.pix_key?.document_number_last4 || row?.br_code?.document_number_last4 || null;
              return {
                id: String(row?.id || externalId || `ext_${idx}`),
                bridge_external_account_id: externalId,
                account_type: accountType,
                currency,
                account_owner_name: row?.account_owner_name ?? null,
                bank_name: row?.bank_name ?? null,
                last_4: last4 ? String(last4) : null,
                rail: row?.rail ?? (accountType === 'iban' ? 'sepa' : accountType === 'clabe' ? 'spei' : accountType === 'pix' ? 'pix' : 'ach'),
                status: String(row?.status || 'active'),
              };
            }).filter((r: any) => !!r.bridge_external_account_id);
            try { localStorage.setItem(extKey, JSON.stringify(normalized)); } catch {}
          }
        }
      } catch {}

      try { localStorage.setItem(warmTsKey, String(Date.now())); } catch { /* noop */ }
    };

    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') ric(() => { void warm(); }, { timeout: 1800 });
    else setTimeout(() => { void warm(); }, 900);
    return () => { cancelled = true; };
  }, [userId]);

  const navigateBack = () => {
    if (navigationStack.length > 1) {
      const newStack = [...navigationStack];
      newStack.pop();
      const previousScreen = newStack[newStack.length - 1];
      setCurrentScreen(previousScreen);
      setNavigationStack(newStack);
      scrollToTop();
    }
  };

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  // Legacy hosted callback (?activation=return). We keep the handler only to
  // strip old params and refresh state without showing activation language.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('activation') !== 'return') return;
      const status = (params.get('status') || '').toLowerCase();
      if (status === 'cancelled' || status === 'failed') {
        toast.message('Verification was not completed. You can try again anytime.');
      } else {
        toast.success('Account status updated.');
        handleRefresh();
      }
      const url = new URL(window.location.href);
      ['activation', 'status', 'tx_ref', 'transaction_id'].forEach(k => url.searchParams.delete(k));
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderScreen = () => {
    const isBusinessAccount = accountType === 'business' || hasBusinessAccountCached();
    switch (currentScreen) {
      case 'cards':
        return <CardsScreen onBack={navigateBack} />;

      case 'send-money':
        // Runtime transfer gate: while backend transfers are disabled, keep all
        // send entry points on the explicit coming-soon screen. This prevents
        // users entering a flow that cannot submit transfer orchestration yet.
        if (!TRANSFERS_LIVE) {
          return <TransfersComingSoonScreen onBack={navigateBack} />;
        }
        return (
          <SendMoneyFlow
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
            onNavigate={navigateTo}
          />
        );

      case 'receive-money':
      case 'ramps':
        return <ReceiveMoneyScreen onBack={navigateBack} />;

      case 'external-accounts':
        if (!EXTERNAL_ACCOUNTS_LIVE) { navigateTo('dashboard'); return null; }
        return (
          <ExternalAccountsScreen
            onBack={navigateBack}
            onAdd={() => navigateTo('add-external-account')}
          />
        );

      case 'external-wallets':
        return (
          <ExternalWalletsScreen
            onBack={navigateBack}
            onNavigate={navigateTo as (s: string) => void}
          />
        );

      // Bulk payouts (payroll/supplier/contractor/marketplace). Same money gate
      // as Send — TRANSFERS_LIVE off routes Send to coming-soon; the backend
      // bridge-bulk-payout fails closed on BRIDGE_TRANSFERS_ENABLED regardless.
      case 'bulk-payout':
        if (!TRANSFERS_LIVE) { navigateTo('dashboard'); return null; }
        return <BulkPayoutScreen onBack={navigateBack} />;

      case 'payroll':
        if (!PAYROLL_NAV_ENABLED) { navigateTo('dashboard'); return null; }
        if (!PAYROLL_RUNTIME_ENABLED) { return <PayrollComingSoonScreen onBack={navigateBack} />; }
        if (!TRANSFERS_LIVE) { navigateTo('dashboard'); return null; }
        return (
          <PayrollScreen
            onBack={navigateBack}
            onOpenBulkPayout={() => navigateTo('bulk-payout')}
          />
        );

      case 'add-external-account':
        if (!EXTERNAL_ACCOUNTS_LIVE) { navigateTo('dashboard'); return null; }
        return (
          <AddExternalAccountScreen
            onBack={navigateBack}
            onAdded={() => { /* list reloads on mount when navigated back */ }}
          />
        );

      case 'exchange':
        return <ExchangeScreen onBack={navigateBack} />;

      case 'two-factor-setup':
        return (
          <TwoFactorSetup
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'pin-setup':
        return (
          <PINSetup
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'biometric-setup':
        return (
          <BiometricSetup
            userId={userId}
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'kyc':
        return (
          <KYCVerification
            userId={userId}
            userEmail=""
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'transactions':
        return <TransactionsScreen userId={userId} onBack={navigateBack} />;

      case 'wallet-detail':
        return (
          <WalletScreen
            userId={userId}
            onBack={navigateBack}
            isVerified={false}
            onNavigate={navigateTo}
          />
        );

      case 'add-wallet':
        return (
          <AddWalletScreen
            userId={userId}
            onBack={navigateBack}
          />
        );

      case 'settings':
        return (
          <SettingsScreen
            userId={userId}
            onBack={navigateBack}
            onLogout={onLogout}
            onLock={onLock}
            onNavigate={navigateTo}
          />
        );

      case 'profile':
        return <ProfileScreen userId={userId} onBack={navigateBack} />;

      case 'change-pin':
        return <ChangePIN userId={userId} onBack={navigateBack} />;

      case 'change-password':
        return <ChangePassword onBack={navigateBack} />;

      case 'country-eligibility':
        return <CountryEligibilityScreen onBack={navigateBack} />;

      case 'terms-of-service':
        return <TermsOfServiceScreen onBack={navigateBack} />;

      case 'privacy-policy':
        return <PrivacyPolicyScreen onBack={navigateBack} />;

      case 'preferences':
        return <PreferencesScreen onBack={navigateBack} />;

      case 'help-center':
        return <HelpCenterScreen onBack={navigateBack} onNavigate={navigateTo} />;

      case 'support':
        return <SupportScreen onBack={navigateBack} onNavigate={navigateTo} />;

      case 'team':
        return (
          <TeamScreen
            accountType={isBusinessAccount ? 'business' : 'individual'}
            onBack={navigateBack}
            onManagePlans={() => navigateTo('kyc')}
          />
        );

      case 'notifications':
        return <NotificationsScreen onBack={navigateBack} onUnreadCountChange={updateUnreadCount} />;

      case 'dashboard':
      case 'home':
      default:
        if (isBusinessAccount) {
          return (
            <BusinessDashboard
              userId={userId}
              onLogout={onLogout}
              onNavigate={navigateTo as (s: string) => void}
            />
          );
        }
        return (
          <Dashboard
            userId={userId}
            onLogout={onLogout}
            onNavigate={navigateTo}
            currentScreen={currentScreen}
          />
        );
    }
  };

  return (
    <div
      className={`overflow-hidden fixed inset-0 ${tc.bg}`}
      style={{ minHeight: 'var(--app-height)', height: 'var(--app-height)', maxHeight: 'var(--app-height)' }}
    >
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />

      <div ref={scrollContainerRef} className="h-full overflow-y-auto overflow-x-hidden relative z-[2] no-scrollbar" style={{ WebkitOverflowScrolling: 'auto', overscrollBehavior: 'none' }}>
        <ErrorBoundary>
          <Suspense fallback={<ScreenSkeleton />}>
            {TOP_LEVEL_SCREENS.has(currentScreen) ? (
              <AppShell
                route={screenToShellRoute(currentScreen)}
                onRoute={(r) => navigateTo(SHELL_TO_SCREEN[r])}
                userName={shellUserName}
                avatarUrl={shellAvatarUrl}
                unreadCount={unreadCount}
                isBusinessAccount={accountType === 'business' || hasBusinessAccountCached()}
                onSignOut={onLogout}
                onLock={onLock}
                onOpenPayoutAccounts={EXTERNAL_ACCOUNTS_LIVE ? () => navigateTo('external-accounts') : undefined}
                onOpenWithdrawalWallets={() => navigateTo('external-wallets')}
                verificationFocus={verificationEmbedOpen}
                verificationFocusTitle={verificationEmbedTitle}
                verificationReturnEnabled={verificationEmbedReturnEnabled}
                onVerificationReturn={() => {
                  try {
                    window.dispatchEvent(new CustomEvent('borderpay:verification_embed_return'));
                  } catch { /* noop */ }
                  navigateTo('kyc');
                }}
                suppressHeaderChrome={currentScreen === 'wallet-detail' || detailSheetOpen}
                suppressBottomChrome={detailSheetOpen}
              >
                {renderScreen()}
              </AppShell>
            ) : (
              renderScreen()
            )}
          </Suspense>
        </ErrorBoundary>
      </div>

      {/* New Device / IP Security Alert */}
      <AnimatePresence>
        {newDeviceDetected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6"
          >
            <div className="w-full max-w-[calc(100vw-48px)] sm:max-w-sm bg-[#0B0E11]/80 backdrop-blur-2xl border border-white/[0.08] rounded-2xl overflow-hidden">
              <div className="h-1 bg-red-500" />
              <div className="p-6">
                <div className="flex flex-col items-center mb-5">
                  <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                    <ShieldAlert className="w-8 h-8 text-red-400" />
                  </div>
                  <h2 className="text-lg font-bold text-white mb-1">New Device Detected</h2>
                  <p className="text-sm text-gray-400 text-center">
                    This account is being accessed from a new device or IP address. If this wasn't you, change your password immediately.
                  </p>
                </div>
                <div className="space-y-3">
                  <button
                    onClick={() => onTrustDevice?.()}
                    className="w-full h-12 rounded-2xl bg-[#C7FF00] text-[#0B0E11] font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    This Was Me
                  </button>
                  <button
                    onClick={() => { onDismissNewDevice?.(); navigateTo('change-password'); }}
                    className="w-full h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 font-medium text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    Secure My Account
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
