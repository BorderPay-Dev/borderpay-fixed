/**
 * BorderPay AppShell — premium glass overlay navigation.
 *
 * Design intent (mobile-first, signed-in app):
 *   • Header is fixed, transparent, blurred (Telegram/WhatsApp pattern):
 *     content scrolls beneath it; the user sees the next row of content
 *     emerging through the header without losing context.
 *   • A pull-down menu hands off to a full-screen overlay drawer
 *     (slide-from-left) for secondary navigation and account actions.
 *   • Floating tab bar holds the primary jumps. Individual accounts see
 *     Home, Send, Receive, Wallet, Account. Business accounts see Home,
 *     Send, Receive, Team, Account.
 *     The bar is semitransparent, rounded, and safe-area aware.
 *   • Lime CTA accent (#C7FF00) only on primary CTAs, plan-active state, and
 *     subscription badges.
 *   • Subtle motion: 220ms ease-out on overlay; reduced-motion respected.
 *
 * Routing model — pure SPA, no external router:
 *   <AppShell route={current} onRoute={setRoute}>
 *     <ScreenSwitch route={current} ... />
 *   </AppShell>
 *
 * Premium / plan badge: drawn next to the user avatar in the header. Reads
 * the subscription row passed by the parent via `subscription` prop so the
 * shell stays presentational.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import {
  Menu, X, Home, ArrowUpRight, ArrowDownLeft, User as UserIcon,
  Bell, ChevronRight, Sparkles, CreditCard, Wallet, Globe2,
  Settings, FileText, ShieldCheck, LogOut, Banknote, Lock, Users,
} from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export type AppRoute =
  | 'dashboard'
  | 'send'
  | 'receive'
  | 'account'
  | 'pricing'
  | 'cards'
  | 'wallet'
  | 'transactions'
  | 'kyc'
  | 'settings'
  | 'notifications'
  | 'team';

export interface ShellSubscription {
  plan_key: string;
  display_name: string;
  is_paid: boolean;
}

export interface AppShellProps {
  route:              AppRoute;
  onRoute:            (next: AppRoute) => void;
  userName?:          string;
  userInitials?:      string;
  avatarUrl?:         string | null;
  unreadCount?:       number;
  subscription?:      ShellSubscription | null;
  isBusinessAccount?: boolean;
  onSignOut?:         () => void;
  /** "Lock app" — local-only lock that keeps a refreshable session behind
   *  biometric. Shown beside Sign out so users who want a quick biometric
   *  return don't tap full Log out by habit. */
  onLock?:            () => void;
  /** When provided, a "Payout accounts" drawer item is shown. MainApp only
   *  passes this when EXTERNAL_ACCOUNTS_LIVE is true, so the entry is fully
   *  gated without plumbing a new AppRoute. */
  onOpenPayoutAccounts?: () => void;
  /** When provided, a "Withdrawal wallets" drawer item is shown (saved external
   *  stablecoin addresses you can withdraw to directly). */
  onOpenWithdrawalWallets?: () => void;
  children:           React.ReactNode;
}

// Floating top header geometry. The header is no longer a full-width bar;
// it's a detached pill (same language as the bottom tab bar). We reserve
// HEADER_BAR_PX + HEADER_TOP_GAP_PX (+breathing room) at the top of <main>
// so content never starts underneath the floating bar.
const HEADER_BAR_PX     = 56;  // height of the floating pill
const HEADER_TOP_GAP_PX = 10;  // gap between the safe-area top and the pill
const HEADER_HEIGHT_PX  = HEADER_BAR_PX + HEADER_TOP_GAP_PX; // scroll threshold
const FOOTER_HEIGHT_PX  = 92;

const PREFETCH_BY_ROUTE: Record<AppRoute, string> = {
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

export function AppShell({
  route, onRoute, userName, userInitials, avatarUrl,
  unreadCount = 0, subscription, isBusinessAccount, onSignOut, onLock,
  onOpenPayoutAccounts,
  onOpenWithdrawalWallets,
  children,
}: AppShellProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  // getTranslation() returns '' for keys missing from the dictionary, and
  // `?? fb` does NOT catch '' — so missing nav.* keys rendered blank labels
  // (only nav.home / nav.cards / nav.settings exist). Fall back to the
  // English label whenever the lookup is empty or just echoes the key.
  const tt = (k: string, fb: string) => {
    const v = (t as any)?.(k);
    return (typeof v === 'string' && v.trim() && v !== k) ? v : fb;
  };

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  // Esc closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof document !== 'undefined') setPortalRoot(document.body);
  }, []);

  // Body scroll lock while drawer is open (mobile).
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  useEffect(() => {
    if (drawerOpen) {
      setHeaderHidden(false);
      return;
    }

    // Instagram-style direction tracking. We accumulate signed scroll delta
    // and flip the header once it crosses a direction threshold:
    //   • scrolling DOWN  > 5px  → hide  (transform: translateY(-100%))
    //   • scrolling UP   > 10px  → reveal (transform: translateY(0))
    // The reveal threshold is larger so tiny upward jitters during a downward
    // flick don't pop the header back in. rAF-throttled to one update/frame.
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (y < 24) {
        setHeaderHidden(false);               // always visible near the top
      } else if (delta > 5 && y > HEADER_HEIGHT_PX) {
        setHeaderHidden(true);                // scrolling DOWN → hide
      } else if (delta < -10) {
        setHeaderHidden(false);               // scrolling UP → reveal
      }
      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [drawerOpen]);

  useEffect(() => {
    setHeaderHidden(false);
  }, [route]);

  const initials = useMemo(() => {
    if (userInitials) return userInitials;
    if (!userName) return '·';
    return userName.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('') || '·';
  }, [userName, userInitials]);

  const go = useCallback((next: AppRoute) => {
    setDrawerOpen(false);
    onRoute(next);
  }, [onRoute]);
  const goFromDrawer = useCallback((next: AppRoute) => {
    setDrawerOpen(false);
    onRoute(next);
  }, [onRoute]);
  const closeDrawerThen = useCallback((fn: () => void) => {
    setDrawerOpen(false);
    fn();
  }, []);

  const prefetchRoute = useCallback((next: AppRoute) => {
    if (typeof window === 'undefined') return;
    (window as any).__borderpay_prefetch?.(PREFETCH_BY_ROUTE[next]);
  }, []);
  const prefetchScreen = useCallback((screen: string) => {
    if (typeof window === 'undefined') return;
    (window as any).__borderpay_prefetch?.(screen);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const prewarmKey = `borderpay_drawer_prewarm_v1:${isBusinessAccount ? 'business' : 'individual'}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (Number.isFinite(last) && Date.now() - last < 120_000) return;
    } catch { /* noop */ }
    // P0 runtime parity: burger navigation must feel instant. Warm common
    // drawer targets at open-time (idle) so first tap is chunk-hot.
    const warm = () => {
      try {
        prefetchRoute('dashboard');
        prefetchRoute('wallet');
        prefetchRoute('send');
        prefetchRoute('receive');
        prefetchRoute('transactions');
        prefetchRoute('settings');
        prefetchRoute('kyc');
        if (isBusinessAccount) prefetchRoute('team');
        if (onOpenPayoutAccounts) prefetchScreen('external-accounts');
        if (onOpenWithdrawalWallets) prefetchScreen('external-wallets');
      } catch { /* noop */ }
    };
    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') {
      try { sessionStorage.setItem(prewarmKey, String(Date.now())); } catch { /* noop */ }
      const id = ric(warm, { timeout: 900 });
      return () => {
        try { (window as any).cancelIdleCallback?.(id); } catch { /* noop */ }
      };
    }
    const t = window.setTimeout(warm, 180);
    try { sessionStorage.setItem(prewarmKey, String(Date.now())); } catch { /* noop */ }
    return () => { window.clearTimeout(t); };
  }, [drawerOpen, isBusinessAccount, onOpenPayoutAccounts, onOpenWithdrawalWallets, prefetchRoute, prefetchScreen]);

  const primaryTabs = useMemo(() => {
    const shared = [
      { route: 'dashboard' as AppRoute, icon: Home, label: tt('nav.home', 'Home') },
      { route: 'send' as AppRoute, icon: ArrowUpRight, label: tt('nav.send', 'Send') },
      { route: 'receive' as AppRoute, icon: ArrowDownLeft, label: tt('nav.receive', 'Receive') },
    ];

    return isBusinessAccount
      ? [
          ...shared,
          { route: 'team' as AppRoute, icon: Users, label: tt('nav.teamShort', 'Team') },
          { route: 'account' as AppRoute, icon: UserIcon, label: tt('nav.account', 'Account') },
        ]
      : [
          ...shared,
          { route: 'wallet' as AppRoute, icon: Wallet, label: tt('nav.wallet', 'Wallet') },
          { route: 'account' as AppRoute, icon: UserIcon, label: tt('nav.account', 'Account') },
        ];
    // `tt` is intentionally not a dependency; labels update when the shell
    // re-renders from the language context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBusinessAccount, t]);

  return (
    <div className={`min-h-screen ${tc.bg} relative`}>
      {/* ── Scrollable content layer ─────────────────────────────────────
          paddingTop / paddingBottom honour iOS notch + Android nav-bar so
          content never sits under the chrome on phones. */}
      <main
        className="relative z-0"
        style={{
          paddingTop:    `calc(env(safe-area-inset-top, 0px) + ${HEADER_BAR_PX + HEADER_TOP_GAP_PX + 16}px)`,
          paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${FOOTER_HEIGHT_PX + 16}px)`,
        }}
      >
        {children}
      </main>

      {/* ── Floating collapsible glass header ────────────────────────────────
          Instagram-style: the burger, notifications and profile toggles are
          three SEPARATE floating circular chips (each its own glass bg +
          shadow), not joined into a single bar. The whole row is sticky,
          hides on scroll-down and reveals on scroll-up, with NO full-width
          divider line. Renders inside the iOS / Android safe-area (notch). */}
      <header
        className="fixed top-0 inset-x-0 z-30 pointer-events-none px-3 will-change-transform"
        style={{
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${HEADER_TOP_GAP_PX}px)`,
          // Instagram-style: hide on scroll-down, reveal on scroll-up. Driven
          // by a raw CSS transform (not framer-motion) for a direct, snappy
          // translate. headerHidden is also forced false on route change and
          // when the drawer opens (see effects above).
          transform: headerHidden ? 'translateY(-100%)' : 'translateY(0)',
          transition: 'transform 0.2s ease',
        }}
        aria-label={tt('shell.header', 'App header')}
      >
        {/* Instagram-style: each control is its OWN floating circular chip
            (separate glass background + shadow), not joined into one bar. */}
        <div
          className="max-w-screen-md mx-auto flex items-center gap-2"
          style={{ height: HEADER_BAR_PX }}
        >
          {/* Burger — own floating chip (left) */}
          <button
            type="button"
            aria-label={tt('shell.menu.open', 'Open menu')}
            onClick={() => setDrawerOpen(true)}
            className={`pointer-events-auto shrink-0 w-11 h-11 flex items-center justify-center rounded-full border ${tc.borderLight} ${tc.headerBg} backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.30)] ${tc.hoverBg} transition-colors`}
          >
            <Menu className={`w-5 h-5 ${tc.text}`} />
          </button>

          {/* Plan badge — own floating chip, only when paid */}
          {subscription?.is_paid && (
            <span className="pointer-events-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#C7FF00] text-black text-[10px] font-bold tracking-wider uppercase shadow-[0_10px_30px_rgba(0,0,0,0.30)]">
              <Sparkles className="w-2.5 h-2.5" />
              {subscription.display_name}
            </span>
          )}

          <div className="flex-1" />

          {/* Notifications — own floating chip (right) */}
          <button
            type="button"
            aria-label={tt('shell.notifications', 'Notifications')}
            onPointerDown={() => prefetchRoute('notifications')}
            onMouseEnter={() => prefetchRoute('notifications')}
            onTouchStart={() => prefetchRoute('notifications')}
            onClick={() => { prefetchRoute('notifications'); go('notifications'); }}
            className={`pointer-events-auto relative shrink-0 w-11 h-11 flex items-center justify-center rounded-full border ${tc.borderLight} ${tc.headerBg} backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.30)] ${tc.hoverBg} transition-colors`}
          >
            <Bell className={`w-5 h-5 ${tc.text}`} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#C7FF00] text-black text-[9px] font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Profile — own floating chip (right) */}
          <button
            type="button"
            aria-label={tt('shell.account', 'Account')}
            onPointerDown={() => prefetchRoute('account')}
            onMouseEnter={() => prefetchRoute('account')}
            onTouchStart={() => prefetchRoute('account')}
            onClick={() => { prefetchRoute('account'); go('account'); }}
            className={`pointer-events-auto shrink-0 w-11 h-11 rounded-full border ${tc.borderLight} ${tc.headerBg} backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.30)] overflow-hidden flex items-center justify-center`}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={userName ?? 'avatar'}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <div className="w-full h-full rounded-full bg-[#C7FF00] text-black font-bold text-xs flex items-center justify-center">
                {initials}
              </div>
            )}
          </button>
        </div>
      </header>

      {/* ── Floating primary tab bar ─────────────────────────────────────── */}
      {(() => {
        const tabBar = (
          <nav
            className="fixed bottom-0 inset-x-0 z-30 pointer-events-none px-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}
            aria-label={tt('shell.bottomNav', 'Primary navigation')}
          >
            <div className="max-w-screen-sm mx-auto">
              <div
                className={`pointer-events-auto h-[66px] grid grid-cols-5 items-stretch rounded-[28px] border ${tc.borderLight} ${tc.headerBg} px-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.34)] backdrop-blur-2xl`}
              >
                {primaryTabs.map(tab => (
                  <BottomButton
                    key={tab.route}
                    active={route === tab.route}
                    icon={tab.icon}
                    label={tab.label}
                    onPrefetch={() => prefetchRoute(tab.route)}
                    onClick={() => go(tab.route)}
                    tc={tc}
                  />
                ))}
              </div>
            </div>
          </nav>
        );
        if (drawerOpen) return null;
        return portalRoot ? createPortal(tabBar, portalRoot) : tabBar;
      })()}

      {/* ── Side drawer overlay ──────────────────────────────────────────── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              className={`fixed top-0 bottom-0 left-0 z-50 w-[88%] max-w-[360px] ${tc.bg} border-r ${tc.border} shadow-2xl overflow-y-auto no-scrollbar`}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label={tt('shell.menu', 'Menu')}
            >
              <div className="sticky top-0 z-10 px-3 pt-safe-header pb-2 bg-transparent">
                <div className="flex items-center justify-between">
                  <div className={`w-11 h-11 rounded-full border ${tc.borderLight} ${tc.headerBg} backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.30)] overflow-hidden flex items-center justify-center`}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={userName ?? ''} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <div className="w-full h-full rounded-full bg-[#C7FF00] text-black font-bold text-sm flex items-center justify-center">{initials}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label={tt('shell.menu.close', 'Close menu')}
                    className={`w-11 h-11 rounded-full border ${tc.borderLight} ${tc.headerBg} backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.30)] flex items-center justify-center ${tc.hoverBg}`}
                  >
                    <X className={`w-5 h-5 ${tc.text}`} />
                  </button>
                </div>
              </div>

              <ul className="py-2">
                <DrawerItem icon={Home}        label={tt('nav.home',         'Home')}           description={tt('nav.home.desc',         'Your dashboard & balances')}      active={route === 'dashboard'}    onPrefetch={() => prefetchRoute('dashboard')}    onClick={() => goFromDrawer('dashboard')}    tc={tc} />
                <DrawerItem icon={Wallet}      label={tt('nav.wallet',       'Wallet')}         description={tt('nav.wallet.desc',       'Balances across your currencies')} active={route === 'wallet'}       onPrefetch={() => prefetchRoute('wallet')}       onClick={() => goFromDrawer('wallet')}       tc={tc} />
                <DrawerItem icon={ArrowUpRight}label={tt('nav.send',         'Send money')}     description={tt('nav.send.desc',         'Pay anyone by bank or crypto')}    active={route === 'send'}         onPrefetch={() => prefetchRoute('send')}         onClick={() => goFromDrawer('send')}         tc={tc} />
                <DrawerItem icon={ArrowDownLeft}label={tt('nav.receive',     'Receive money')}  description={tt('nav.receive.desc',      'Get paid into your accounts')}     active={route === 'receive'}      onPrefetch={() => prefetchRoute('receive')}      onClick={() => goFromDrawer('receive')}      tc={tc} />
                <DrawerItem icon={FileText}    label={tt('nav.transactions', 'Transactions')}   description={tt('nav.transactions.desc', 'Your full activity history')}      active={route === 'transactions'} onPrefetch={() => prefetchRoute('transactions')} onClick={() => goFromDrawer('transactions')} tc={tc} />
                {onOpenPayoutAccounts && (
                  <DrawerItem icon={Banknote}  label={tt('nav.external_accounts', 'External Accounts')} description={tt('nav.external_accounts.desc', 'Manage withdrawal destinations')} active={false} onPrefetch={() => prefetchScreen('external-accounts')} onClick={() => closeDrawerThen(onOpenPayoutAccounts)} tc={tc} />
                )}
                {onOpenWithdrawalWallets && (
                  <DrawerItem icon={Wallet}    label={tt('nav.withdrawal_wallets', 'Withdrawal wallets')} description={tt('nav.withdrawal_wallets.desc', 'Save addresses & withdraw stablecoin')} active={false} onPrefetch={() => prefetchScreen('external-wallets')} onClick={() => closeDrawerThen(onOpenWithdrawalWallets)} tc={tc} />
                )}
                <DrawerItem icon={CreditCard}  label={tt('nav.cards',        'Cards')}          description={tt('nav.cards.desc',        'Card issuing — not yet available')} active={route === 'cards'}        onPrefetch={() => prefetchRoute('cards')}        onClick={() => goFromDrawer('cards')}        tc={tc} badge="Locked" />
                {isBusinessAccount && (
                  <DrawerItem icon={UserIcon}  label={tt('nav.team',         'Team members')}   description={tt('nav.team.desc',         'Manage who can access this account')} active={route === 'team'}      onPrefetch={() => prefetchRoute('team')}         onClick={() => goFromDrawer('team')}         tc={tc} />
                )}
                <div className={`my-2 border-t ${tc.borderLight}`} />
                <DrawerItem icon={ShieldCheck} label={isBusinessAccount ? tt('nav.kyb', 'Business KYB') : tt('nav.kyc', 'Identity & KYC')} description={isBusinessAccount ? tt('nav.kyb.desc', 'Verify your business') : tt('nav.kyc.desc', 'Verify your identity')} active={route === 'kyc'} onPrefetch={() => prefetchRoute('kyc')} onClick={() => goFromDrawer('kyc')} tc={tc} />
                <DrawerItem icon={Settings}    label={tt('nav.settings',     'Settings')}       description={tt('nav.settings.desc',     'App, security & preferences')}     active={route === 'settings'}     onPrefetch={() => prefetchRoute('settings')}     onClick={() => goFromDrawer('settings')}     tc={tc} />
                {onLock && (
                  <DrawerItem icon={Lock}      label={tt('nav.lockApp',      'Lock app')}       description={tt('nav.lockApp.desc',      'Lock now, return with biometrics')} onClick={() => closeDrawerThen(onLock)}                   tc={tc} />
                )}
                {onSignOut && (
                  <DrawerItem icon={LogOut}    label={tt('nav.signOut',      'Sign out')}       description={tt('nav.signOut.desc',      'Log out of BorderPay')}            onClick={() => closeDrawerThen(onSignOut)}                tc={tc} danger />
                )}
              </ul>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function BottomButton({
  active, icon: Icon, label, onClick, onPrefetch, tc,
}: {
  active?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  onPrefetch?: () => void;
  tc: ReturnType<typeof useThemeClasses>;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPrefetch}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
      onClick={() => {
        onPrefetch?.();
        onClick();
      }}
      aria-current={active ? 'page' : undefined}
      className="relative h-full min-w-0 flex flex-col items-center justify-center gap-0.5 rounded-[22px] transition-colors"
    >
      {active && (
        <motion.span
          layoutId="bottom-nav-active-bg"
          className={`absolute inset-1.5 rounded-[20px] ${tc.isLight ? 'bg-black/[0.06]' : 'bg-white/[0.08]'}`}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        />
      )}
      <Icon className={`relative z-[1] w-5 h-5 ${active ? 'text-[#C7FF00]' : tc.textMuted}`} />
      <span className={`relative z-[1] max-w-full truncate text-[10px] font-semibold ${active ? 'text-[#C7FF00]' : tc.textMuted}`}>{label}</span>
      {active && (
        <motion.span
          layoutId="bottom-nav-active-dot"
          className="absolute top-1.5 z-[1] w-1.5 h-1.5 rounded-full bg-[#C7FF00]"
          transition={{ duration: 0.22, ease: 'easeOut' }}
        />
      )}
    </button>
  );
}

function DrawerItem({
  icon: Icon, label, description, active, onClick, onPrefetch, tc, badge, highlight, danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** One-line helper text under the label so each menu item explains itself. */
  description?: string;
  active?: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
  tc: ReturnType<typeof useThemeClasses>;
  badge?: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onPointerDown={onPrefetch}
        onMouseEnter={onPrefetch}
        onTouchStart={onPrefetch}
        onClick={() => {
          onPrefetch?.();
          onClick();
        }}
        className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${tc.hoverBg} ${active ? (tc.isLight ? 'bg-black/[0.04]' : 'bg-white/[0.04]') : ''}`}
      >
        <Icon className={`w-5 h-5 flex-shrink-0 ${danger ? 'text-red-500' : active || highlight ? 'text-[#C7FF00]' : tc.textSecondary}`} />
        <span className="flex-1 min-w-0 text-left">
          <span className={`block text-sm font-medium leading-tight ${danger ? 'text-red-500' : tc.text}`}>{label}</span>
          {description && (
            <span className={`block text-[11px] leading-snug mt-0.5 ${tc.textMuted}`}>{description}</span>
          )}
        </span>
        {badge && (
          <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider ${tc.textMuted}`}>{badge}</span>
        )}
        {!badge && !danger && <ChevronRight className={`w-4 h-4 flex-shrink-0 ${tc.textMuted}`} />}
      </button>
    </li>
  );
}

export default AppShell;
