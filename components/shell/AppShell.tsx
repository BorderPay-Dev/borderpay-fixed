/**
 * BorderPay AppShell — premium glass overlay navigation.
 *
 * Design intent (mobile-first, signed-in app):
 *   • Header is fixed, transparent, blurred (Telegram/WhatsApp pattern):
 *     content scrolls beneath it; the user sees the next row of content
 *     emerging through the header without losing context.
 *   • A pull-down menu hands off to a full-screen overlay drawer
 *     (slide-from-left) — primary navigation lives there, not in a tab bar.
 *   • Bottom action bar holds 4 primary jumps: Home, Send, Receive, Account.
 *     The bar is semitransparent + safe-area aware.
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
import {
  Menu, X, Home, ArrowUpRight, ArrowDownLeft, User as UserIcon,
  Bell, ChevronRight, Sparkles, CreditCard, Wallet, Globe2,
  Settings, FileText, ShieldCheck, LogOut,
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
  children:           React.ReactNode;
}

const HEADER_HEIGHT_PX = 64;
const FOOTER_HEIGHT_PX = 72;

export function AppShell({
  route, onRoute, userName, userInitials, avatarUrl,
  unreadCount = 0, subscription, isBusinessAccount, onSignOut,
  children,
}: AppShellProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Esc closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawerOpen]);

  // Body scroll lock while drawer is open (mobile).
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  const initials = useMemo(() => {
    if (userInitials) return userInitials;
    if (!userName) return '·';
    return userName.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('') || '·';
  }, [userName, userInitials]);

  const go = useCallback((next: AppRoute) => {
    setDrawerOpen(false);
    onRoute(next);
  }, [onRoute]);

  return (
    <div className={`min-h-screen ${tc.bg} relative`}>
      {/* ── Scrollable content layer ───────────────────────────────────── */}
      <main
        className="relative z-0"
        style={{
          paddingTop:    HEADER_HEIGHT_PX,
          paddingBottom: FOOTER_HEIGHT_PX + 16,
        }}
      >
        {children}
      </main>

      {/* ── Premium glass header (transparent, content scrolls beneath) ── */}
      <header
        className={`fixed top-0 inset-x-0 z-30 ${tc.headerBg} border-b ${tc.borderLight}`}
        style={{ height: HEADER_HEIGHT_PX }}
        aria-label={tt('shell.header', 'BorderPay header')}
      >
        <div className="h-full max-w-screen-md mx-auto px-4 flex items-center gap-3">
          <button
            type="button"
            aria-label={tt('shell.menu.open', 'Open menu')}
            onClick={() => setDrawerOpen(true)}
            className={`p-2 -ml-2 rounded-full ${tc.hoverBg} transition-colors`}
          >
            <Menu className={`w-5 h-5 ${tc.text}`} />
          </button>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className={`font-semibold ${tc.text} text-base sm:text-lg tracking-tight`}>BorderPay</span>
            {subscription?.is_paid && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#C7FF00] text-black text-[10px] font-bold tracking-wider uppercase">
                <Sparkles className="w-2.5 h-2.5" />
                {subscription.display_name}
              </span>
            )}
          </div>

          <button
            type="button"
            aria-label={tt('shell.notifications', 'Notifications')}
            onClick={() => go('notifications')}
            className={`relative p-2 rounded-full ${tc.hoverBg} transition-colors`}
          >
            <Bell className={`w-5 h-5 ${tc.text}`} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#C7FF00] text-black text-[9px] font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label={tt('shell.account', 'Account')}
            onClick={() => go('account')}
            className="ml-1"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={userName ?? 'avatar'}
                className="w-9 h-9 rounded-full object-cover border border-white/10"
              />
            ) : (
              <div className={`w-9 h-9 rounded-full bg-[#C7FF00] text-black font-bold text-xs flex items-center justify-center`}>
                {initials}
              </div>
            )}
          </button>
        </div>
      </header>

      {/* ── Bottom primary action bar ────────────────────────────────────── */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-30 ${tc.headerBg} border-t ${tc.borderLight}`}
        style={{ height: FOOTER_HEIGHT_PX, paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label={tt('shell.bottomNav', 'Primary navigation')}
      >
        <div className="h-full max-w-screen-md mx-auto px-2 grid grid-cols-4">
          <BottomButton active={route === 'dashboard'} icon={Home}         label={tt('nav.home',    'Home')}    onClick={() => go('dashboard')} tc={tc} />
          <BottomButton active={route === 'send'}      icon={ArrowUpRight} label={tt('nav.send',    'Send')}    onClick={() => go('send')}      tc={tc} />
          <BottomButton active={route === 'receive'}   icon={ArrowDownLeft}label={tt('nav.receive', 'Receive')} onClick={() => go('receive')}   tc={tc} />
          <BottomButton active={route === 'account'}   icon={UserIcon}     label={tt('nav.account', 'Account')} onClick={() => go('account')}   tc={tc} />
        </div>
      </nav>

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
              className={`fixed top-0 bottom-0 left-0 z-50 w-[88%] max-w-[360px] ${tc.bg} border-r ${tc.border} shadow-2xl overflow-y-auto`}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label={tt('shell.menu', 'Menu')}
            >
              <div className={`sticky top-0 ${tc.headerBg} border-b ${tc.borderLight} px-4 py-3 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={userName ?? ''} className="w-10 h-10 rounded-full object-cover border border-white/10" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#C7FF00] text-black font-bold text-sm flex items-center justify-center">{initials}</div>
                  )}
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${tc.text} truncate`}>{userName || tt('shell.guest', 'Guest')}</div>
                    {subscription && (
                      <div className="inline-flex items-center gap-1 mt-0.5">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${subscription.is_paid ? 'text-[#C7FF00]' : tc.textMuted}`}>
                          {subscription.display_name}
                        </span>
                        {!subscription.is_paid && (
                          <button onClick={() => go('pricing')} className="text-[10px] font-semibold text-[#C7FF00] hover:underline">
                            {tt('shell.upgrade', 'Upgrade')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label={tt('shell.menu.close', 'Close menu')}
                  className={`p-2 -mr-2 rounded-full ${tc.hoverBg}`}
                >
                  <X className={`w-5 h-5 ${tc.text}`} />
                </button>
              </div>

              <ul className="py-2">
                <DrawerItem icon={Home}        label={tt('nav.home',         'Home')}           active={route === 'dashboard'}    onClick={() => go('dashboard')}    tc={tc} />
                <DrawerItem icon={Wallet}      label={tt('nav.wallet',       'Wallet')}         active={route === 'wallet'}       onClick={() => go('wallet')}       tc={tc} />
                <DrawerItem icon={ArrowUpRight}label={tt('nav.send',         'Send money')}     active={route === 'send'}         onClick={() => go('send')}         tc={tc} />
                <DrawerItem icon={ArrowDownLeft}label={tt('nav.receive',     'Receive money')}  active={route === 'receive'}      onClick={() => go('receive')}      tc={tc} />
                <DrawerItem icon={FileText}    label={tt('nav.transactions', 'Transactions')}   active={route === 'transactions'} onClick={() => go('transactions')} tc={tc} />
                <DrawerItem icon={CreditCard}  label={tt('nav.cards',        'Cards')}          active={route === 'cards'}        onClick={() => go('cards')}        tc={tc} badge="Coming Soon" />
                <DrawerItem icon={Globe2}      label={tt('nav.pricing',      'Plans & pricing')}active={route === 'pricing'}      onClick={() => go('pricing')}      tc={tc} highlight={!subscription?.is_paid} />
                {isBusinessAccount && (
                  <DrawerItem icon={UserIcon}  label={tt('nav.team',         'Team members')}   active={route === 'team'}         onClick={() => go('team')}         tc={tc} />
                )}
                <div className={`my-2 border-t ${tc.borderLight}`} />
                <DrawerItem icon={ShieldCheck} label={tt('nav.kyc',          'Identity & KYC')} active={route === 'kyc'}          onClick={() => go('kyc')}          tc={tc} />
                <DrawerItem icon={Settings}    label={tt('nav.settings',     'Settings')}       active={route === 'settings'}     onClick={() => go('settings')}     tc={tc} />
                {onSignOut && (
                  <DrawerItem icon={LogOut}    label={tt('nav.signOut',      'Sign out')}       onClick={onSignOut}                tc={tc} danger />
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
  active, icon: Icon, label, onClick, tc,
}: {
  active?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  tc: ReturnType<typeof useThemeClasses>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-full flex flex-col items-center justify-center gap-0.5"
    >
      <Icon className={`w-5 h-5 ${active ? 'text-[#C7FF00]' : tc.textMuted}`} />
      <span className={`text-[10px] font-medium ${active ? 'text-[#C7FF00]' : tc.textMuted}`}>{label}</span>
      {active && (
        <motion.span
          layoutId="bottom-nav-active"
          className="absolute top-1 w-8 h-0.5 rounded-full bg-[#C7FF00]"
          transition={{ duration: 0.22, ease: 'easeOut' }}
        />
      )}
    </button>
  );
}

function DrawerItem({
  icon: Icon, label, active, onClick, tc, badge, highlight, danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  tc: ReturnType<typeof useThemeClasses>;
  badge?: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${tc.hoverBg} ${active ? (tc.isLight ? 'bg-black/[0.04]' : 'bg-white/[0.04]') : ''}`}
      >
        <Icon className={`w-5 h-5 ${danger ? 'text-red-500' : active || highlight ? 'text-[#C7FF00]' : tc.textSecondary}`} />
        <span className={`flex-1 text-left text-sm font-medium ${danger ? 'text-red-500' : tc.text}`}>{label}</span>
        {badge && (
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${tc.textMuted}`}>{badge}</span>
        )}
        {!badge && !danger && <ChevronRight className={`w-4 h-4 ${tc.textMuted}`} />}
      </button>
    </li>
  );
}

export default AppShell;
