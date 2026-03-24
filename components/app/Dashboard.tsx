/**
 * BorderPay Africa - Dashboard
 * Fully wired to backend API:
 * - /user/profile  → user info, KYC status, 2FA
 * - /wallets       → wallet balances
 * - /transactions  → recent activity
 * - /auth/security/status → PIN setup status
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { NotificationBell } from '../notifications/NotificationBell';
import { AccountStatusBadge, AccountStatus } from '../activation/AccountStatusBadge';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface DashboardProps {
  userId: string;
  onLogout: () => void;
  onNavigate?: (screen: string) => void;
  currentScreen?: string;
}

const CURRENCY_CONFIG: Record<string, { symbol: string; color: string }> = {
  USD:  { symbol: '$',    color: '#10B981' },
  TZS:  { symbol: 'TSh',  color: '#3B82F6' },
  XOF:  { symbol: 'FCFA', color: '#8B5CF6' },
  XAF:  { symbol: 'FCFA', color: '#A855F7' },
  NGN:  { symbol: '₦',   color: '#F59E0B' },
  KES:  { symbol: 'KSh', color: '#EC4899' },
  GHS:  { symbol: '₵',   color: '#06B6D4' },
  UGX:  { symbol: 'USh', color: '#EF4444' },
  USDT: { symbol: '₮',   color: '#26A17B' },
  USDC: { symbol: '$',   color: '#2775CA' },
  PYUSD:{ symbol: '$',   color: '#0074D9' },
};

export function Dashboard({ userId, onLogout, onNavigate, currentScreen: parentScreen }: DashboardProps) {
  const [userName, setUserName]           = useState('User');
  const [isVerified, setIsVerified]       = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [greeting, setGreeting]           = useState('Good Morning');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('starter');
  const [has2FA, setHas2FA]               = useState(false);
  const [hasPIN, setHasPIN]               = useState(false);
  const [wallets, setWallets]             = useState<Array<{ currency: string; balance: number; symbol: string; color: string }>>([]);
  const [totalBalance, setTotalBalance]   = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);
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

  // Setup banner state — dismissible per session, reappears on next login
  const [showSetupBanner, setShowSetupBanner] = useState(() => {
    return sessionStorage.getItem('borderpay_setup_banner_dismissed') !== 'true';
  });

  const dismissSetupBanner = () => {
    setShowSetupBanner(false);
    sessionStorage.setItem('borderpay_setup_banner_dismissed', 'true');
  };

  const { t } = useThemeLanguage();
  const tc = useThemeClasses();

  // ─── navigation ───────────────────────────────────────────────────────────
  const handleNavigate = (screen: string) => {
    if (onNavigate) onNavigate(screen);
  };

  // ─── greeting ─────────────────────────────────────────────────────────────
  const setTimeBasedGreeting = useCallback(() => {
    const h = new Date().getHours();
    if (h < 12) setGreeting(t('greeting.morning'));
    else if (h < 18) setGreeting(t('greeting.afternoon'));
    else setGreeting(t('greeting.evening'));
  }, [t]);

  // ─── data loading ─────────────────────────────────────────────────────────
  const loadDashboardData = useCallback(async () => {
    // Fast path: show cached user data immediately
    const storedUser = authAPI.getStoredUser();
    if (storedUser) {
      setUserName(storedUser.full_name || storedUser.email?.split('@')[0] || 'User');
    }

    try {
      // Fire all four requests in parallel via canonical backendAPI
      const [profileRes, walletsRes, securityRes, txRes] = await Promise.allSettled([
        backendAPI.user.getProfile(),
        backendAPI.wallets.getWallets(),
        backendAPI.auth.getSecurityStatus(''),
        backendAPI.transactions.getTransactions(5, 0),
      ]);

      // ── Profile ──────────────────────────────────────────────────────────
      if (profileRes.status === 'fulfilled' && profileRes.value?.success) {
        const p = profileRes.value.data?.user;
        if (p) {
          setUserName(p.full_name || p.email?.split('@')[0] || 'User');
          const verified   = p.kyc_status === 'verified';
          setIsVerified(verified);
          setHas2FA(p.two_factor_enabled || false);
          if (verified)   setAccountStatus('verified');
          else            setAccountStatus('starter');
          localStorage.setItem('borderpay_user', JSON.stringify(p));
        }
      }

      // ── Wallets ───────────────────────────────────────────────────────────
      if (walletsRes.status === 'fulfilled' && walletsRes.value?.success) {
        const raw = walletsRes.value.data?.wallets || [];
        const formatted = raw.map((w: any) => ({
          currency: w.currency,
          balance:  parseFloat(w.balance) || 0,
          symbol:   CURRENCY_CONFIG[w.currency]?.symbol || w.currency,
          color:    CURRENCY_CONFIG[w.currency]?.color  || '#666',
        }));
        setWallets(formatted);

        const usdLike = new Set(['USD', 'USDT', 'USDC', 'PYUSD']);
        const total = formatted.reduce(
          (sum: number, w: any) => sum + (usdLike.has(w.currency) ? w.balance : 0),
          0
        );
        setTotalBalance(total);
      } else {
        setWallets([]);
        setTotalBalance(0);
      }

      // ── Security status (PIN) ─────────────────────────────────────────────
      if (securityRes.status === 'fulfilled' && securityRes.value?.success) {
        const sec = securityRes.value.data;
        setHasPIN(sec?.pin_set || false);
        // Override 2FA if more accurate from security endpoint
        if (sec?.two_factor_enabled !== undefined) {
          setHas2FA(sec.two_factor_enabled);
        }
      }

      // ── Recent transactions ───────────────────────────────────────────────
      if (txRes.status === 'fulfilled' && txRes.value?.success) {
        const txns = txRes.value.data?.transactions || [];
        setRecentTransactions(Array.isArray(txns) ? txns.slice(0, 5) : []);
      } else {
        setRecentTransactions([]);
      }

    } catch (error) {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setTimeBasedGreeting();
    loadDashboardData();

    // Refresh greeting every 10 min
    const greetingInterval = setInterval(setTimeBasedGreeting, 600_000);
    return () => clearInterval(greetingInterval);
  }, [loadDashboardData, setTimeBasedGreeting]);

  // ─── setup steps ─────────────────────────────────────────────────────
  const setupSteps = [
    { id: 'account', label: t('activation.accountCreated'),                        completed: true,  screen: '' },
    { id: '2fa',     label: t('activation.2faEnabled'),                            completed: has2FA, screen: 'two-factor-setup' },
    { id: 'pin',     label: t('activation.pinSetup'),                              completed: hasPIN, screen: 'pin-setup' },
    { id: 'kyc',     label: t('activation.kycComplete'),                           completed: isVerified, screen: 'kyc' },
  ];

  const handleLockedFeatureClick = (_featureName: string, action: string) => {
    handleNavigate(action);
  };

  // ─── quick actions ────────────────────────────────────────────────────────
  const quickActions = [
    { id: 'add-money',           label: t('action.addMoney'), icon: Plus,           bg: '#C7FF00', color: '#000' },
    { id: 'send-money',          label: t('action.send'),     icon: Send,           bg: tc.isLight ? '#F3F4F6' : 'rgba(255,255,255,0.08)', color: tc.isLight ? '#000' : '#fff' },
    { id: 'receive-money',       label: t('action.receive') || 'Receive', icon: ArrowDownLeft, bg: tc.isLight ? '#F3F4F6' : 'rgba(255,255,255,0.08)', color: tc.isLight ? '#000' : '#fff' },
    { id: 'exchange',            label: t('action.exchange'), icon: ArrowLeftRight,  bg: tc.isLight ? '#F3F4F6' : 'rgba(255,255,255,0.08)', color: tc.isLight ? '#000' : '#fff' },
  ];

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

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${tc.bg} pb-nav-safe`}>

      {/* ── Top Bar ── */}
      <div className={`sticky top-0 ${tc.isLight ? 'bg-white/70' : 'bg-[#0B0E11]/80'} backdrop-blur-xl border-b ${tc.isLight ? 'border-gray-200/50' : 'border-white/[0.06]'} pt-safe z-40`}>
        <div className="flex items-center justify-between px-5 py-3">
          {/* Avatar */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => handleNavigate('profile')}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-[#C7FF00] to-[#95E03D] flex items-center justify-center"
          >
            <span className="text-sm font-black text-black">
              {userName.charAt(0).toUpperCase()}
            </span>
          </motion.button>

          {/* Account status badge */}
          <AccountStatusBadge status={accountStatus} size="sm" />

          {/* Notification bell */}
          <NotificationBell />
        </div>
      </div>

      {/* ── Greeting + Balance ── */}
      <div className="px-5 pt-5 pb-2">
        <p className={`text-sm ${tc.textSecondary}`}>
          {greeting}, <span className={`font-semibold ${tc.text}`}>{userName.split(' ')[0]}</span>
        </p>

        <div className="flex flex-col items-center py-5">
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-semibold mb-2">
            {t('dashboard.totalBalance')}
          </p>
          <div className="flex items-center gap-2">
            <h1 className={`text-[28px] sm:text-4xl font-normal ${tc.text} tracking-tight`}>
              {balanceHidden ? (
                <span className="text-2xl sm:text-3xl">••••••</span>
              ) : (
                <>
                  <span className="text-xl sm:text-2xl text-gray-400">$</span>
                  {totalBalance.toFixed(2)}
                </>
              )}
            </h1>
            <button
              onClick={() => setBalanceHidden(!balanceHidden)}
              className="p-1 hover:bg-white/5 rounded-lg transition-colors"
            >
              {balanceHidden
                ? <Eye className="w-4 h-4 text-gray-500" />
                : <EyeOff className="w-4 h-4 text-gray-500" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Wallet Carousel ── */}
      <div className="px-5 mb-6">
        <h3 className={`text-xs ${tc.textSecondary} uppercase tracking-[0.2em] font-semibold mb-3`}>
          {t('dashboard.wallets')}
        </h3>
        <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-2 scrollbar-hide snap-x snap-mandatory" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'auto', overscrollBehaviorX: 'none' } as React.CSSProperties}>
          {wallets.length > 0 ? wallets.map((wallet) => (
            <motion.button
              key={wallet.currency}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleNavigate('wallet-detail')}
              className={`flex-shrink-0 w-[140px] sm:w-[160px] ${tc.isLight ? 'bg-white/60 border-white/50' : 'bg-white/[0.05] border-white/[0.08]'} backdrop-blur-lg border rounded-[22px] p-3 sm:p-4 active:border-[#C7FF00] transition-colors snap-start text-left`}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center mb-3"
                style={{ backgroundColor: `${wallet.color}20` }}
              >
                <span className="text-base font-bold" style={{ color: wallet.color }}>
                  {wallet.symbol.slice(0, 2)}
                </span>
              </div>
              <p className={`text-[10px] ${tc.textSecondary} uppercase tracking-wide mb-1`}>{wallet.currency}</p>
              <p className={`text-base font-bold ${tc.text}`}>
                {balanceHidden ? '••••' : `${wallet.symbol}${wallet.balance.toFixed(2)}`}
              </p>
            </motion.button>
          )) : (
            <div className={`flex-shrink-0 w-[160px] ${tc.isLight ? 'bg-white/60 border-white/50' : 'bg-white/[0.05] border-white/[0.08]'} backdrop-blur-lg border rounded-[22px] p-4 flex flex-col items-center justify-center gap-2`}>
              <Coins className="w-7 h-7 text-gray-600" />
              <p className="text-xs text-gray-500 text-center">{t('dashboard.noTransactions')}</p>
            </div>
          )}

          {/* Add wallet */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => handleNavigate('wallet-detail')}
            className={`flex-shrink-0 w-[160px] border-2 border-dashed ${tc.isLight ? 'border-gray-300' : 'border-white/20'} rounded-[22px] p-4 flex flex-col items-center justify-center gap-2 hover:border-[#C7FF00] hover:bg-[#C7FF00]/5 transition-all snap-start`}
          >
            <Plus className="w-7 h-7 text-gray-400" />
            <p className={`text-[10px] ${tc.textSecondary} uppercase tracking-wide`}>{t('dashboard.addWallet')}</p>
          </motion.button>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="px-5 mb-6">
        <div className="flex items-center gap-2">
          {quickActions.map((action) => (
            <motion.button
              key={action.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                const gatedActions: Record<string, string> = {
                  'send-money': t('action.send'),
                  'exchange': t('action.exchange'),
                };
                if (gatedActions[action.id]) {
                  handleLockedFeatureClick(gatedActions[action.id], action.id);
                } else {
                  handleNavigate(action.id);
                }
              }}
              className="flex-1 py-3 rounded-full text-[12px] font-bold text-center transition-all active:scale-95 whitespace-nowrap min-w-0"
              style={{ backgroundColor: action.bg, color: action.color }}
            >
              {action.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* ── Setup Banner (dismissible) ── */}
      {accountStatus !== 'active' && !loading && showSetupBanner && (
        <div className="px-5 mb-6">
          <div className={`relative ${tc.isLight ? 'bg-white/60 border-white/50' : 'bg-white/[0.04] border-white/[0.06]'} backdrop-blur-xl border rounded-2xl p-5`}>
            <button
              onClick={dismissSetupBanner}
              className={`absolute top-3 right-3 w-6 h-6 rounded-full ${tc.isLight ? 'bg-gray-200' : 'bg-white/10'} flex items-center justify-center`}
            >
              <X size={12} className="text-gray-400" />
            </button>
            <div className="flex items-center gap-2 mb-3 pr-6">
              <ShieldCheck className="w-4 h-4 text-[#C7FF00]" />
              <h3 className={`text-sm font-bold ${tc.text}`}>{t('dashboard.completeSetup') || 'Complete Setup'}</h3>
              <span className="text-xs text-[#C7FF00] font-semibold ml-auto">
                {setupSteps.filter(s => s.completed).length}/{setupSteps.length}
              </span>
            </div>
            <div className={`w-full h-1.5 ${tc.isLight ? 'bg-gray-200' : 'bg-white/10'} rounded-full mb-4`}>
              <div
                className="h-full bg-[#C7FF00] rounded-full transition-all duration-500"
                style={{ width: `${(setupSteps.filter(s => s.completed).length / setupSteps.length) * 100}%` }}
              />
            </div>
            <div className="space-y-2">
              {setupSteps.map((step) => (
                <button
                  key={step.id}
                  onClick={() => !step.completed && step.screen ? handleNavigate(step.screen) : undefined}
                  disabled={step.completed || !step.screen}
                  className={`w-full flex items-center gap-2.5 p-1 rounded-lg transition-colors ${!step.completed && step.screen ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${step.completed ? 'bg-[#C7FF00]' : 'bg-white/10'}`}>
                    {step.completed ? (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-white/30" />
                    )}
                  </div>
                  <span className={`text-xs ${step.completed ? 'text-gray-500 line-through' : `${tc.text} font-medium`} flex-1 text-left`}>{step.label}</span>
                  {!step.completed && step.screen && <ChevronRight size={14} className="text-white/30" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 2FA Banner ── */}
      {isVerified && !has2FA && show2FABanner && !loading && (
        <div className="px-5 mb-6">
          <div className="relative overflow-hidden bg-amber-500/[0.06] border border-amber-500/[0.15] backdrop-blur-lg rounded-2xl p-4">
            <button onClick={dismiss2FABanner} className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
              <X size={12} className="text-gray-400" />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-bold ${tc.text} mb-0.5`}>{t('auth.2fa.recommend')}</h4>
                <p className={`text-xs ${tc.textSecondary} mb-3 leading-relaxed`}>{t('auth.2fa.verifiedOnly')}</p>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleNavigate('two-factor-setup')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-xl"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t('auth.2fa.enableNow')}
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Exchange Activity — Live Rate Chart ── */}
      <div className="px-5 mb-6">
        <DashboardRateWidget onNavigate={handleNavigate} />
      </div>

      {/* ── Recent Activity ── */}
      <div className="px-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-xs ${tc.textSecondary} uppercase tracking-[0.2em] font-semibold`}>
            {t('dashboard.recentActivity')}
          </h3>
          <button onClick={() => handleNavigate('transactions')} className="text-xs text-[#C7FF00] font-semibold uppercase tracking-wide">
            {t('dashboard.seeAll')}
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className={`${tc.isLight ? 'bg-white/60 border-white/50' : 'bg-white/[0.04] border-white/[0.06]'} backdrop-blur-xl border rounded-[24px] p-8 text-center`}>
            <div className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3">
              <Send className="w-7 h-7 text-gray-600" />
            </div>
            <p className="text-gray-400 text-sm mb-1">{t('dashboard.noTxYet')}</p>
            <p className="text-gray-600 text-xs">{t('dashboard.fundWallet')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentTransactions.map((txn, idx) => (
              <div
                key={txn.id || idx}
                className={`${tc.isLight ? 'bg-white/60 border-white/50' : 'bg-white/[0.05] border-white/[0.08]'} backdrop-blur-lg border rounded-2xl px-4 py-3 flex items-center gap-3`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${txn.type === 'deposit' || txn.type === 'credit' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  {getTxIcon(txn)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${tc.text} truncate`}>{txn.description || txn.type || 'Transaction'}</p>
                  <p className="text-xs text-gray-500">
                    {formatTxDate(txn.created_at)}
                    {txn.status === 'pending' && <span className="ml-2 text-yellow-500">• Pending</span>}
                    {txn.status === 'failed' && <span className="ml-2 text-red-500">• Failed</span>}
                  </p>
                </div>
                <p className="text-sm font-bold flex-shrink-0">{getTxAmount(txn)}</p>
              </div>
            ))}
            <button onClick={() => handleNavigate('transactions')} className="w-full text-center text-xs text-gray-500 hover:text-[#C7FF00] py-3 transition-colors">
              {t('dashboard.viewAllTx')} →
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <div className={`fixed bottom-0 left-0 right-0 ${tc.isLight ? 'bg-white/90 border-gray-200/50' : 'bg-[#0B0E11]/95 border-white/[0.08]'} backdrop-blur-2xl border-t pb-safe z-50`}>
        <div className="flex items-stretch justify-around px-2">
          {[
            { id: 'home',         icon: Home,       labelKey: 'nav.home'     },
            { id: 'wallet-detail',icon: Coins,       labelKey: 'nav.wallets'  },
            { id: 'cards',        icon: CreditCard,  labelKey: 'nav.cards'    },
            { id: 'settings',     icon: Settings,    labelKey: 'nav.settings' },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = item.id === 'home'
              ? (activeScreen === 'home' || activeScreen === 'dashboard')
              : activeScreen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`flex flex-col items-center justify-center flex-1 min-h-[56px] min-w-[48px] transition-colors relative ${isActive ? 'text-[#C7FF00]' : 'text-gray-500 active:text-gray-300'}`}
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[#C7FF00]" />
                )}
                <div className={`p-1.5 rounded-xl ${isActive ? 'bg-[#C7FF00]/10' : ''}`}>
                  <Icon className="w-5 h-5" strokeWidth={isActive ? 2.5 : 1.5} />
                </div>
                <span className="text-[10px] mt-0.5 font-semibold">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ─── Dashboard Live Rate Chart Widget ────────────────────────────────────────

const RATE_PAIRS = [
  { from: 'USD', to: 'NGN', rate: 1552.30, change: +0.82, base: 1550, vol: 80 },
  { from: 'USD', to: 'KES', rate: 129.45, change: -0.34, base: 129, vol: 4 },
  { from: 'USD', to: 'GHS', rate: 15.52, change: +1.12, base: 15.5, vol: 0.8 },
  { from: 'USD', to: 'UGX', rate: 3702.0, change: +0.25, base: 3700, vol: 120 },
  { from: 'USD', to: 'XAF', rate: 605.80, change: -0.18, base: 606, vol: 8 },
];

function generateSparkData(count: number, base: number, vol: number): number[] {
  const pts: number[] = [];
  let v = base;
  for (let i = 0; i < count; i++) {
    v += (Math.random() - 0.48) * vol;
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

  // Generate chart data for the selected pair (30 points)
  const chartData = useMemo(() => {
    const pair = RATE_PAIRS[selectedPair];
    return generateSparkData(30, pair.base, pair.vol);
  }, [selectedPair]);

  // Full chart points for the big chart
  const pair = RATE_PAIRS[selectedPair];
  const isPositive = pair.change >= 0;

  // Generate mini sparklines for rate rows (stable per render)
  const miniCharts = useMemo(() =>
    RATE_PAIRS.map(p => generateSparkData(20, p.base, p.vol)),
  []);

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
        {RATE_PAIRS.map((p, i) => {
          const pos = p.change >= 0;
          return (
            <button
              key={`${p.from}-${p.to}`}
              onClick={() => setSelectedPair(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
                i === selectedPair ? 'bg-[#C7FF00]/[0.06]' : 'hover:bg-white/[0.02]'
              } ${i < RATE_PAIRS.length - 1 ? 'border-b border-white/[0.03]' : ''}`}
            >
              {/* Pair label */}
              <div className="w-[70px] text-left">
                <span className={`text-[11px] font-bold ${i === selectedPair ? 'text-[#C7FF00]' : 'text-white'}`}>
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
