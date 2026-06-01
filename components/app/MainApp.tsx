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

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { backendAPI } from '../../utils/api/backendAPI';
import { Dashboard } from './Dashboard';
import { useVerification } from '../../utils/verification/useVerification';
import { useThemeClasses, useThemeLanguage } from '../../utils/i18n/ThemeLanguageContext';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { UpgradeModal } from '../pricing/UpgradeModal';
import { getDefaultPlanFor, getPlan, type PlanKey } from '../../utils/subscriptions/plans';
import { AppShell, type AppRoute, type ShellSubscription } from '../shell/AppShell';
import { TRANSFERS_LIVE, EXTERNAL_ACCOUNTS_LIVE } from '../../utils/featureFlags';
import { TransfersComingSoonScreen } from '../send/TransfersComingSoonScreen';

// ─── Lazy-loaded screens ──────────────────────────────────────────────
// Each loader is exported via `prefetchers` so that hover/touchstart on a
// nav button can pre-warm the chunk before the click fires.
const lazyImport = <T extends { default: React.ComponentType<any> }>(
  loader: () => Promise<T>
) => {
  const Component = lazy(loader);
  (Component as any).preload = loader;
  return Component;
};

const CardsScreen = lazyImport(() => import('../cards/CardsScreen').then(m => ({ default: m.CardsScreen })));
const BusinessDashboard = lazyImport(() => import('../business/BusinessDashboard').then(m => ({ default: m.BusinessDashboard })));
const TwoFactorSetup = lazyImport(() => import('../security/TwoFactorSetup').then(m => ({ default: m.TwoFactorSetup })));
const PINSetup = lazyImport(() => import('../security/PINSetup').then(m => ({ default: m.PINSetup })));
const KYCVerification = lazyImport(() => import('../kyc/KYCVerification').then(m => ({ default: m.KYCVerification })));
const SendMoneyFlow = lazyImport(() => import('../send/SendMoneyFlow').then(m => ({ default: m.SendMoneyFlow })));
const TransactionsScreen = lazyImport(() => import('../transactions/TransactionsScreen').then(m => ({ default: m.TransactionsScreen })));
const AddMoneyScreen = lazyImport(() => import('../deposit/AddMoneyScreen').then(m => ({ default: m.AddMoneyScreen })));
const SettingsScreen = lazyImport(() => import('../settings/SettingsScreen').then(m => ({ default: m.SettingsScreen })));
const WalletScreen = lazyImport(() => import('../wallet/WalletScreen').then(m => ({ default: m.WalletScreen })));
const ProfileScreen = lazyImport(() => import('../profile/ProfileScreen').then(m => ({ default: m.ProfileScreen })));
const ChangePIN = lazyImport(() => import('../settings/ChangePIN').then(m => ({ default: m.ChangePIN })));
const ChangePassword = lazyImport(() => import('../settings/ChangePassword').then(m => ({ default: m.ChangePassword })));
const PaymentMethods = lazyImport(() => import('../settings/PaymentMethods').then(m => ({ default: m.PaymentMethods })));
const TermsOfServiceScreen = lazyImport(() => import('../legal/TermsOfServiceScreen').then(m => ({ default: m.TermsOfServiceScreen })));
const PrivacyPolicyScreen = lazyImport(() => import('../legal/PrivacyPolicyScreen').then(m => ({ default: m.PrivacyPolicyScreen })));
const PreferencesScreen = lazyImport(() => import('../app/PreferencesScreen').then(m => ({ default: m.PreferencesScreen })));
const CardRestrictionsScreen = lazyImport(() => import('../compliance/CardRestrictionsScreen').then(m => ({ default: m.CardRestrictionsScreen })));
const ReceiveMoneyScreen = lazyImport(() => import('../receive/ReceiveMoneyScreen').then(m => ({ default: m.ReceiveMoneyScreen })));
const ExternalAccountsScreen = lazyImport(() => import('../payouts/ExternalAccountsScreen').then(m => ({ default: m.ExternalAccountsScreen })));
const AddExternalAccountScreen = lazyImport(() => import('../payouts/AddExternalAccountScreen').then(m => ({ default: m.AddExternalAccountScreen })));
const ExchangeScreen = lazyImport(() => import('../exchange/ExchangeScreen').then(m => ({ default: m.ExchangeScreen })));
const CurrencyConverter = lazyImport(() => import('../conversion/CurrencyConverter').then(m => ({ default: m.CurrencyConverter })));
const USDAccountScreen = lazyImport(() => import('../accounts/USDAccountScreen').then(m => ({ default: m.USDAccountScreen })));
const MomoCollectionScreen = lazyImport(() => import('../momo/MomoCollectionScreen').then(m => ({ default: m.MomoCollectionScreen })));
const CreateCounterpartyScreen = lazyImport(() => import('../counterparty/CreateCounterpartyScreen').then(m => ({ default: m.CreateCounterpartyScreen })));
const StablecoinDepositScreen = lazyImport(() => import('../wallets/StablecoinDepositScreen').then(m => ({ default: m.StablecoinDepositScreen })));
const StablecoinConfirmScreen = lazyImport(() => import('../wallets/StablecoinConfirmScreen').then(m => ({ default: m.StablecoinConfirmScreen })));
const ReferralScreen = lazyImport(() => import('../referral/ReferralScreen').then(m => ({ default: m.ReferralScreen })));
const BiometricSetup = lazyImport(() => import('../security/BiometricSetup').then(m => ({ default: m.BiometricSetup })));
const HelpCenterScreen = lazyImport(() => import('../settings/HelpCenterScreen').then(m => ({ default: m.HelpCenterScreen })));
const ProofOfAddressScreen = lazyImport(() => import('../settings/ProofOfAddressScreen').then(m => ({ default: m.ProofOfAddressScreen })));
const PricingScreen       = lazyImport(() => import('../pricing/PricingScreen').then(m => ({ default: m.PricingScreen })));
const TeamScreen          = lazyImport(() => import('../team/TeamScreen').then(m => ({ default: m.TeamScreen })));
const NotificationsScreen = lazyImport(() => import('../notifications/NotificationsScreen').then(m => ({ default: m.NotificationsScreen })));

// Map of screen → preload function. Exposed on `window.__borderpay_prefetch`
// so any nav button can call it on hover/touchstart.
const SCREEN_PRELOADERS: Record<string, () => Promise<unknown>> = {
  cards: (CardsScreen as any).preload,
  'send-money': (SendMoneyFlow as any).preload,
  'receive-money': (ReceiveMoneyScreen as any).preload,
  exchange: (ExchangeScreen as any).preload,
  converter: (CurrencyConverter as any).preload,
  deposit: (AddMoneyScreen as any).preload,
  'add-money': (AddMoneyScreen as any).preload,
  'two-factor-setup': (TwoFactorSetup as any).preload,
  'pin-setup': (PINSetup as any).preload,
  'biometric-setup': (BiometricSetup as any).preload,
  kyc: (KYCVerification as any).preload,
  transactions: (TransactionsScreen as any).preload,
  'wallet-detail': (WalletScreen as any).preload,
  settings: (SettingsScreen as any).preload,
  profile: (ProfileScreen as any).preload,
  'change-pin': (ChangePIN as any).preload,
  'change-password': (ChangePassword as any).preload,
  'payment-methods': (PaymentMethods as any).preload,
  'card-restrictions': (CardRestrictionsScreen as any).preload,
  'terms-of-service': (TermsOfServiceScreen as any).preload,
  'privacy-policy': (PrivacyPolicyScreen as any).preload,
  preferences: (PreferencesScreen as any).preload,
  'usd-account': (USDAccountScreen as any).preload,
  'momo-collect': (MomoCollectionScreen as any).preload,
  'create-counterparty': (CreateCounterpartyScreen as any).preload,
  'stablecoin-deposit': (StablecoinDepositScreen as any).preload,
  'stablecoin-confirm': (StablecoinConfirmScreen as any).preload,
  'help-center': (HelpCenterScreen as any).preload,
  'proof-of-address': (ProofOfAddressScreen as any).preload,
  referral: (ReferralScreen as any).preload,
  pricing:       (PricingScreen as any).preload,
  team:          (TeamScreen    as any).preload,
  notifications: (NotificationsScreen as any).preload,
};

export function prefetchScreen(name: string) {
  const fn = SCREEN_PRELOADERS[name];
  if (fn) { try { fn(); } catch { /* silent */ } }
}

if (typeof window !== 'undefined') {
  (window as any).__borderpay_prefetch = prefetchScreen;
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
  newDeviceDetected?: boolean;
  onDismissNewDevice?: () => void;
  onTrustDevice?: () => void;
}

export type AppScreen =
  | 'dashboard'
  | 'home'
  | 'cards'
  | 'send-money'
  | 'receive-money'
  | 'exchange'
  | 'converter'
  | 'deposit'
  | 'add-money'
  | 'transactions'
  | 'wallet-detail'
  | 'two-factor-setup'
  | 'pin-setup'
  | 'change-pin'
  | 'change-password'
  | 'payment-methods'
  | 'card-restrictions'
  | 'kyc'
  | 'settings'
  | 'profile'
  | 'terms-of-service'
  | 'privacy-policy'
  | 'preferences'
  | 'usd-account'
  | 'momo-collect'
  | 'create-counterparty'
  | 'stablecoin-deposit'
  | 'stablecoin-confirm'
  | 'referral'
  | 'biometric-setup'
  | 'help-center'
  | 'proof-of-address'
  | 'pricing'
  | 'team'
  | 'notifications'
  | 'external-accounts'
  | 'add-external-account';

// ── AppShell ↔ MainApp routing bridge ──────────────────────────────────
// The shell speaks `AppRoute` (Home/Send/Receive/Account + drawer items).
// MainApp's internal screen graph is finer-grained (`AppScreen`). These
// helpers translate between the two so the shell is presentational and
// MainApp keeps full control of sub-flow routing.

const TOP_LEVEL_SCREENS: ReadonlySet<AppScreen> = new Set([
  'dashboard', 'home', 'wallet-detail', 'transactions',
  'cards', 'profile', 'settings', 'kyc', 'pricing', 'team', 'notifications',
]);

const SHELL_TO_SCREEN: Record<AppRoute, AppScreen> = {
  dashboard:     'dashboard',
  send:          'send-money',
  receive:       'receive-money',
  account:       'profile',
  pricing:       'pricing',
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
    case 'pricing':        return 'pricing';
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

export function MainApp({ userId, onLogout, newDeviceDetected, onDismissNewDevice, onTrustDevice }: MainAppProps) {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('dashboard');
  const [navigationStack, setNavigationStack] = useState<AppScreen[]>(['dashboard']);
  const verificationStatus = useVerification(userId);
  const [refreshKey, setRefreshKey] = useState(0);
  const tc = useThemeClasses();
  const tl = useThemeLanguage();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [stablecoinConfirmData, setStablecoinConfirmData] = useState<StablecoinConfirmData | null>(null);

  // ─── Subscription state ────────────────────────────────────────────────
  // Loaded once on mount; refreshed after a successful upgrade. Determines
  // which paid features (EUR/GBP virtual accounts, team seats, future cards)
  // are enabled in the UI.
  const [currentPlanKey, setCurrentPlanKey] = useState<PlanKey | null>(null);

  // ─── Upgrade paywall ──────────────────────────────────────────────────
  // `upgradeTarget` holds the plan_key the user is being asked to upgrade to.
  // null = modal closed. Triggered by:
  //   • Manual upgrade CTAs (window.__borderpay_open_upgrade(planKey))
  //   • Backend 402 `plan_required` responses (apiCall dispatches
  //     `borderpay:plan_required` CustomEvent; we listen below and pop it).
  const [upgradeTarget, setUpgradeTarget] = useState<PlanKey | null>(null);

  // ─── Shell display props (avatar / name / unread bell badge) ───────────
  // Hydrated from cache for first paint, then refreshed by the
  // get-profile + notifications calls below.
  const [shellUserName, setShellUserName] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_user') || '{}')?.full_name || ''; } catch { return ''; }
  });
  const [shellAvatarUrl, setShellAvatarUrl] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_user') || '{}')?.profile_picture_url || null; } catch { return null; }
  });
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // ─── ADDITIVE: account-type routing ────────────────────────────────────
  // Default to 'individual' for first paint (preserves existing behaviour
  // for the 100% of users that ARE individual). Background-refresh from
  // user_profiles to flip to 'business' if the user is a business account.
  const [accountType, setAccountType] = useState<'individual' | 'business'>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('borderpay_user') || 'null');
      return cached?.account_type === 'business' ? 'business' : 'individual';
    } catch { return 'individual'; }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await backendAPI.user.getProfile();
        if (cancelled) return;
        if (r?.success && r.data?.user) {
          const u: any = r.data.user;
          const t = u.account_type === 'business' ? 'business' : 'individual';
          if (t !== accountType) setAccountType(t);
          // Shell display props — kept in MainApp so AppShell stays presentational.
          if (u.full_name && u.full_name !== shellUserName) setShellUserName(u.full_name);
          if (u.profile_picture_url !== undefined && u.profile_picture_url !== shellAvatarUrl) {
            setShellAvatarUrl(u.profile_picture_url || null);
          }
          // Update cache so other screens reading from localStorage are in sync.
          try {
            const cached = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
            localStorage.setItem('borderpay_user', JSON.stringify({ ...cached, ...u, account_type: t }));
          } catch { /* ignore */ }
        }
      } catch { /* keep cached */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ─── Unread notifications badge for AppShell ──────────────────────────
  // One-shot on mount + on every refresh; cheap GET so we don't poll.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r: any = await backendAPI.notifications.getUnreadCount();
        if (cancelled) return;
        const n = Number(r?.data?.count ?? r?.data?.unread_count ?? 0);
        if (Number.isFinite(n)) setUnreadCount(n);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  // ─── Load subscription row once per session ────────────────────────────
  // Reads user_subscriptions via the subscription-current edge function. If
  // the user has no row (shouldn't happen post-Day-2 since auth-signup seeds
  // a starter row), we fall back to the account-type default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await backendAPI.subscription.current();
        if (cancelled) return;
        const planKey = r?.success && r.data?.subscription?.plan_key
          ? (r.data.subscription.plan_key as PlanKey)
          : getDefaultPlanFor(accountType).key;
        setCurrentPlanKey(planKey);
      } catch {
        setCurrentPlanKey(getDefaultPlanFor(accountType).key);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, accountType, refreshKey]);

  // ─── Paywall: open UpgradeModal on 402 plan_required ───────────────────
  // apiCall dispatches `borderpay:plan_required` from any edge function
  // that gates a feature behind a paid plan. We map the upgrade_to plan
  // (which the server picks based on account_type) to our local state.
  useEffect(() => {
    const onPlanRequired = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const target = (detail.upgrade_to as PlanKey | undefined)
        ?? (accountType === 'business' ? 'business_growth' : 'individual_premium');
      setUpgradeTarget(target);
    };
    window.addEventListener('borderpay:plan_required', onPlanRequired as EventListener);
    return () => window.removeEventListener('borderpay:plan_required', onPlanRequired as EventListener);
  }, [accountType]);

  // Public helper any screen can call to open the upgrade modal manually.
  // Used by Dashboard / Pricing CTAs without prop-drilling.
  useEffect(() => {
    (window as any).__borderpay_open_upgrade = (planKey: PlanKey) => setUpgradeTarget(planKey);
    return () => { delete (window as any).__borderpay_open_upgrade; };
  }, []);

  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }, []);

  const navigateTo = (screen: AppScreen | string) => {
    const target = screen as AppScreen;
    const isAlreadyHere =
      currentScreen === target ||
      (target === 'home' && currentScreen === 'dashboard') ||
      (target === 'dashboard' && currentScreen === 'home');

    if (isAlreadyHere) return;

    // Pre-warm the chunk in case the user reached this state without a
    // hover preload (e.g. programmatic nav)
    prefetchScreen(target);

    setCurrentScreen(target);
    setNavigationStack(prev => [...prev, target]);
    scrollToTop();
  };

  React.useEffect(() => {
    (window as any).__borderpay_navigate = navigateTo;
    return () => { delete (window as any).__borderpay_navigate; };
  });

  // Prefetch most-likely-next screens once the dashboard is mounted, so the
  // user's first navigation is instant. Runs once per session, in background.
  React.useEffect(() => {
    let cancelled = false;
    const idle = (cb: () => void) => {
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(cb, { timeout: 1500 });
      else setTimeout(cb, 800);
    };
    idle(() => {
      if (cancelled) return;
      ['transactions', 'send-money', 'receive-money', 'add-money', 'profile', 'settings', 'preferences', 'wallet-detail', 'kyc', 'pricing', 'notifications', 'exchange']
        .forEach(prefetchScreen);
    });
    return () => { cancelled = true; };
  }, []);

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

  const renderScreen = () => {
    switch (currentScreen) {
      case 'cards':
        return <CardsScreen onBack={navigateBack} />;

      case 'send-money':
        // P1 partner onboarding readiness: while the backend
        // `BRIDGE_TRANSFERS_ENABLED` env on `bridge-transfer` is false,
        // we route every Send entry point (bottom-nav, drawer,
        // Dashboard CTA, BusinessDashboard CTA) here. Renders an
        // honest "Transfers activating soon" screen instead of the
        // full SendMoneyFlow, which would otherwise hit broken
        // counterparty-lookup endpoints (get-account-rails,
        // resolve-account, etc.) and fail at the bridge-transfer
        // submit anyway. Flip `TRANSFERS_LIVE` (utils/featureFlags.ts)
        // in lockstep with the backend env when transfers ship.
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
        return <ReceiveMoneyScreen onBack={navigateBack} />;

      // Bridge external accounts (payout destinations). Flag-gated: when
      // EXTERNAL_ACCOUNTS_LIVE is false these route to the dashboard so the
      // feature is fully inert until the table/edge/secret are in place.
      case 'external-accounts':
        if (!EXTERNAL_ACCOUNTS_LIVE) { navigateTo('dashboard'); return null; }
        return (
          <ExternalAccountsScreen
            onBack={navigateBack}
            onAdd={() => navigateTo('add-external-account')}
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

      case 'converter':
        return (
          <CurrencyConverter
            userId={userId}
            standalone={true}
            onBack={navigateBack}
            onConvert={() => navigateTo('exchange')}
          />
        );

      case 'deposit':
      case 'add-money':
        return <AddMoneyScreen userId={userId} onBack={navigateBack} />;

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
            isVerified={verificationStatus.isVerified}
            onNavigate={navigateTo}
          />
        );

      case 'settings':
        return (
          <SettingsScreen
            userId={userId}
            onBack={navigateBack}
            onLogout={onLogout}
            onNavigate={navigateTo}
          />
        );

      case 'profile':
        return <ProfileScreen userId={userId} onBack={navigateBack} />;

      case 'change-pin':
        return <ChangePIN userId={userId} onBack={navigateBack} />;

      case 'change-password':
        return <ChangePassword onBack={navigateBack} />;

      case 'payment-methods':
        return <PaymentMethods onBack={navigateBack} />;

      case 'card-restrictions':
        return <CardRestrictionsScreen onBack={navigateBack} />;

      case 'terms-of-service':
        return <TermsOfServiceScreen onBack={navigateBack} />;

      case 'privacy-policy':
        return <PrivacyPolicyScreen onBack={navigateBack} />;

      case 'preferences':
        return <PreferencesScreen onBack={navigateBack} />;

      case 'usd-account':
        return (
          <USDAccountScreen
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'momo-collect':
        return (
          <MomoCollectionScreen
            onBack={navigateBack}
            onComplete={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'create-counterparty':
        return (
          <CreateCounterpartyScreen
            userId={userId}
            onBack={navigateBack}
            onSuccess={() => { navigateBack(); handleRefresh(); }}
          />
        );

      case 'stablecoin-deposit':
        return (
          <StablecoinDepositScreen
            onBack={navigateBack}
            onConfirm={(data: StablecoinConfirmData) => {
              setStablecoinConfirmData(data);
              navigateTo('stablecoin-confirm');
            }}
          />
        );

      case 'stablecoin-confirm':
        return stablecoinConfirmData ? (
          <StablecoinConfirmScreen
            onBack={navigateBack}
            onDone={() => {
              setStablecoinConfirmData(null);
              navigateTo('dashboard');
              handleRefresh();
            }}
            txType={stablecoinConfirmData.txType}
            currency={stablecoinConfirmData.currency}
            amount={stablecoinConfirmData.amount}
            network={stablecoinConfirmData.network}
            address={stablecoinConfirmData.address}
            txHash={stablecoinConfirmData.txHash}
          />
        ) : null;

      case 'help-center':
        return <HelpCenterScreen onBack={navigateBack} onNavigate={navigateTo} />;

      case 'proof-of-address':
        return <ProofOfAddressScreen onBack={navigateBack} />;

      case 'referral':
        return <ReferralScreen onBack={navigateBack} />;

      case 'pricing':
        return (
          <PricingScreen
            insideApp
            accountType={accountType}
            currentPlanKey={currentPlanKey}
            onBack={navigateBack}
            onUpgrade={(planKey: PlanKey) => setUpgradeTarget(planKey)}
          />
        );

      case 'team':
        return (
          <TeamScreen
            accountType={accountType}
            onBack={navigateBack}
            onManagePlans={() => navigateTo('pricing')}
          />
        );

      case 'notifications':
        return <NotificationsScreen onBack={navigateBack} />;

      case 'dashboard':
      case 'home':
      default:
        if (accountType === 'business') {
          return (
            <BusinessDashboard
              userId={userId}
              onLogout={onLogout}
              onNavigate={navigateTo as (s: string) => void}
              planKey={currentPlanKey}
              onUpgrade={() => setUpgradeTarget('business_growth')}
            />
          );
        }
        return (
          <Dashboard
            userId={userId}
            onLogout={onLogout}
            onNavigate={navigateTo}
            currentScreen={currentScreen}
            planKey={currentPlanKey}
            onUpgrade={() => setUpgradeTarget('individual_premium')}
          />
        );
    }
  };

  return (
    <div className={`min-h-[100dvh] max-h-[100dvh] overflow-hidden fixed inset-0 ${tc.bg}`}>
      <div className="glass-gradient-bg" />
      <div className="glass-noise-overlay" />

      <div ref={scrollContainerRef} className="h-full overflow-y-auto overflow-x-hidden relative z-[2]" style={{ WebkitOverflowScrolling: 'auto', overscrollBehavior: 'none' }}>
        <ErrorBoundary key={currentScreen}>
          <Suspense fallback={<ScreenSkeleton />}>
            {TOP_LEVEL_SCREENS.has(currentScreen) ? (
              <AppShell
                route={screenToShellRoute(currentScreen)}
                onRoute={(r) => navigateTo(SHELL_TO_SCREEN[r])}
                userName={shellUserName}
                avatarUrl={shellAvatarUrl}
                unreadCount={unreadCount}
                subscription={currentPlanKey ? ({
                  plan_key:     currentPlanKey,
                  display_name: getPlan(currentPlanKey).display_name,
                  is_paid:      (getPlan(currentPlanKey).price_monthly_usd ?? 0) > 0,
                } as ShellSubscription) : null}
                isBusinessAccount={accountType === 'business'}
                onSignOut={onLogout}
                onOpenPayoutAccounts={EXTERNAL_ACCOUNTS_LIVE ? () => navigateTo('external-accounts') : undefined}
              >
                {renderScreen()}
              </AppShell>
            ) : (
              renderScreen()
            )}
          </Suspense>
        </ErrorBoundary>
      </div>

      {/* ── Wallet-debit upgrade paywall ───────────────────────────────── */}
      {/* Opened by any 402 plan_required response (via DOM event) or by an
          explicit window.__borderpay_open_upgrade(planKey) call from a CTA. */}
      {upgradeTarget && (
        <UpgradeModal
          open
          planKey={upgradeTarget}
          userId={userId}
          isBusinessAccount={accountType === 'business'}
          onClose={() => setUpgradeTarget(null)}
          onUpgraded={() => {
            setUpgradeTarget(null);
            handleRefresh();          // re-fetches subscription via refreshKey dep
          }}
        />
      )}

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
