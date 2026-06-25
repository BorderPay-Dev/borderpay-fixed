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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2, Send, Download, RefreshCw, Loader2, Wallet,
  AlertCircle, ShieldCheck, ShieldAlert, Users, Banknote, ArrowRightLeft, BriefcaseBusiness, FileText,
} from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { authAPI } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { BridgeKycStatusCard } from '../dashboard/bridge/BridgeKycStatusCard';
import { CardsLockedCard } from '../dashboard/bridge/CardsLockedCard';
import { PlanStatusCard } from '../dashboard/PlanStatusCard';
import { TreasuryCard } from './TreasuryCard';
import { ExchangeRateWidget } from '../dashboard/fx/ExchangeRateWidget';
import { AffiliateBanner } from '../referral/AffiliateBanner';
import { friendlyError } from '../../utils/errors/friendlyError';
import type { PlanKey } from '../../utils/subscriptions/plans';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { FX_NAV_ENABLED, PAYROLL_RUNTIME_ENABLED } from '../../utils/featureFlags';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

const BIZ_WALLETS_KEY = 'borderpay_business_dash_wallets_v1';
const BIZ_TX_KEY = 'borderpay_business_dash_tx_v1';
function readBizWallets(cacheKey: string): WalletRow[] {
  try { const raw = localStorage.getItem(cacheKey); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function readBizTx(cacheKey: string): any[] {
  try { const raw = localStorage.getItem(cacheKey); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

interface BusinessDashboardProps {
  userId:    string;
  onLogout:  () => void;
  onNavigate: (screen: string) => void;
  /** Hydrated by MainApp from `subscription-current`. null while loading. */
  planKey?:  PlanKey | null;
  /** Opens the UpgradeModal at MainApp level for the appropriate paid tier. */
  onUpgrade?: () => void;
}

interface WalletRow {
  currency: string;
  balance:  number;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', USDT: '$', USDC: '$',
};

function fmt(amount: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency] || '';
  return `${sym}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BusinessDashboard({ userId, onLogout, onNavigate, planKey, onUpgrade }: BusinessDashboardProps) {
  const tc = useThemeClasses();
  const stored = useMemo(() => authAPI.getStoredUser() || {}, []);
  const initialCompanyName = useMemo(
    () => stored?.company_name || '',
    [stored],
  );
  const initialCountry = useMemo(
    () => (stored?.country ? String(stored.country) : null),
    [stored],
  );

  const [companyName, setCompanyName]               = useState<string>(initialCompanyName);
  const [registrationNumber, setRegistrationNumber] = useState<string | null>(null);
  const [country, setCountry]                       = useState<string | null>(initialCountry);
  const [profileError, setProfileError]             = useState<string | null>(null);
  const [affiliateKycStatus, setAffiliateKycStatus] = useState<'verified' | 'pending'>(() => {
    const raw = String(
      stored?.bridge_kyb_status ||
      stored?.bridge_verification_status ||
      stored?.verification_status ||
      '',
    ).toLowerCase();
    return (raw === 'approved' || raw === 'verified' || raw === 'active') ? 'verified' : 'pending';
  });

  // Seed wallets from cache so the balance + treasury paint instantly.
  const bizWalletsCacheKey = useMemo(
    () => financialCacheKey(BIZ_WALLETS_KEY, { userId, accountType: 'business' }),
    [userId],
  );
  const cachedBizWallets = useMemo(() => readBizWallets(bizWalletsCacheKey), [bizWalletsCacheKey]);
  const bizTxCacheKey = useMemo(
    () => financialCacheKey(BIZ_TX_KEY, { userId, accountType: 'business' }),
    [userId],
  );
  const cachedBizTransactions = useMemo(() => readBizTx(bizTxCacheKey), [bizTxCacheKey]);
  const [wallets, setWallets]             = useState<WalletRow[]>(cachedBizWallets);
  const [transactions, setTransactions]   = useState<any[]>(cachedBizTransactions);
  const [walletsLoading, setWalletsLoading] = useState(cachedBizWallets.length === 0);
  const [walletsError, setWalletsError]   = useState<string | null>(null);

  useEffect(() => {
    navPerfTrackCache('dashboard', cachedBizWallets.length > 0);
  }, [cachedBizWallets.length]);

  const usdLikeTotal = useMemo(
    () => wallets.filter(w => ['USD', 'USDT', 'USDC', 'PYUSD', 'USDB'].includes(w.currency))
                 .reduce((s, w) => s + (w.balance || 0), 0),
    [wallets],
  );

  const toWalletRows = (raw: any[]): WalletRow[] => raw.map((w: any) => ({
    currency: String(w?.currency || '').toUpperCase(),
    balance: parseFloat(w?.balance) || 0,
  })).filter((w: WalletRow) => !!w.currency);

  const loadWallets = async () => {
    // Do not blank a cached dashboard on refresh; only skeleton on cold start.
    if (wallets.length === 0) setWalletsLoading(true);
    setWalletsError(null);
    try {
      const walletRouteRes: any = await backendAPI.financial.getWalletRouteData();
      const walletOk = walletRouteRes?.success;
      if (walletOk) {
        const walletData = walletRouteRes?.data || {};
        const raw = Array.isArray(walletData?.wallets) ? walletData.wallets : [];
        const formatted = toWalletRows(raw);
        setWallets(formatted);
        try { localStorage.setItem(bizWalletsCacheKey, JSON.stringify(formatted)); } catch { /* noop */ }
      } else {
        // Fallback path: if wallet route data fails, try canonical snapshot so
        // Accounts can still render without a hard error on dashboard.
        const snapshotRes: any = await backendAPI.financial.getSnapshot(12);
        const snapshotOk = snapshotRes?.success;
        if (snapshotOk) {
          const raw = Array.isArray(snapshotRes?.data?.wallets) ? snapshotRes.data.wallets : [];
          const formatted = toWalletRows(raw);
          if (formatted.length > 0 || wallets.length === 0) {
            setWallets(formatted);
            try { localStorage.setItem(bizWalletsCacheKey, JSON.stringify(formatted)); } catch { /* noop */ }
          }
        } else if (wallets.length === 0) {
          setWalletsError(friendlyError(walletRouteRes?.error || snapshotRes?.error, 'Could not load wallets'));
        }
      }

      // Never block first paint on profile/transaction enrichment.
      void Promise.allSettled([
        backendAPI.transactions.getTransactions(12, 0),
        backendAPI.user.getProfile(),
      ]).then(([txRes, profileRes]) => {
        const txOk = txRes.status === 'fulfilled' && (txRes.value as any)?.success;
        if (txOk) {
          const tx = Array.isArray((txRes as PromiseFulfilledResult<any>).value?.data?.transactions)
            ? (txRes as PromiseFulfilledResult<any>).value.data.transactions
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
          const kybState = String(
            profile?.bridge_kyb_status ||
            profile?.bridge_verification_status ||
            profile?.verification_status ||
            profile?.bridge_account_status ||
            '',
          ).toLowerCase();
          setAffiliateKycStatus(
            (kybState === 'approved' || kybState === 'verified' || kybState === 'active')
              ? 'verified'
              : 'pending',
          );
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
          } catch { /* ignore cache write */ }
        }
      });
    } catch (e: any) {
      if (wallets.length === 0) setWalletsError(friendlyError(e, 'Could not load wallets'));
      if (companyName.length === 0) setProfileError('Your business profile is being set up. Add company details from Profile.');
    } finally {
      setWalletsLoading(false);
    }
  };

  useEffect(() => {
    loadWallets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const refreshAll = () => { loadWallets(); };

  const initials = (companyName || 'B').slice(0, 2).toUpperCase();

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      {/* ── 1. Business identity row ─────────────────────────────────── */}
      <section className="flex items-center justify-between px-5 sm:px-6 pt-5 gap-3">
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

      <div className="space-y-6 pb-6">
        {/* ── 2. Hero balance ───────────────────────────────────────── */}
        <section className="px-5 sm:px-6 pt-6">
          <p className={`text-[10px] ${tc.textMuted} uppercase tracking-[0.18em] font-semibold mb-2`}>
            Total balance · USD
          </p>
          <div className="flex items-end gap-2">
            <h2 className={`${tc.text} font-semibold tracking-tight tabular-nums leading-none text-[44px] sm:text-[56px]`}>
              <span className={`text-2xl sm:text-3xl ${tc.textMuted} mr-1 align-top`}>$</span>
              {usdLikeTotal.toFixed(2).split('.')[0]}
              <span className={`text-2xl sm:text-3xl ${tc.textMuted}`}>.{usdLikeTotal.toFixed(2).split('.')[1]}</span>
            </h2>
          </div>
          <p className={`text-[11px] ${tc.textMuted} mt-1.5`}>
            {wallets.length === 0
              ? 'No accounts yet. Open one to start.'
              : `Across ${wallets.length} ${wallets.length === 1 ? 'account' : 'accounts'}`}
          </p>
          {(registrationNumber || country) && (
            <p className={`text-[10px] ${tc.textMuted} mt-3 font-mono uppercase tracking-wide truncate`}>
              {[registrationNumber, country].filter(Boolean).join(' · ')}
            </p>
          )}
        </section>

        {/* ── 3. Quick actions ─────────────────────────────────────── */}
        <section className="px-5 sm:px-6">
          <div className="grid grid-cols-4 gap-2">
            <BizChip label="Send"    Icon={Send}     onClick={() => onNavigate('send-money')}    tc={tc} />
            <BizChip label="Receive" Icon={Download} onClick={() => onNavigate('receive-money')} tc={tc} />
            <BizChip label="Activity" Icon={FileText} onClick={() => onNavigate('transactions')} tc={tc} />
            <BizChip label="Payouts" Icon={Banknote} onClick={() => onNavigate('bulk-payout')}   tc={tc} primary />
            <BizChip label="Team"    Icon={Users}    onClick={() => onNavigate('team')}          tc={tc} />
            <BizChip
              label={PAYROLL_RUNTIME_ENABLED ? 'Payroll' : 'Payroll Soon'}
              Icon={BriefcaseBusiness}
              onClick={() => onNavigate('payroll')}
              tc={tc}
              disabled={!PAYROLL_RUNTIME_ENABLED}
            />
            <BizChip
              label="FX"
              Icon={ArrowRightLeft}
              onClick={() => onNavigate('exchange')}
              tc={tc}
            />
            <BizChip label="Wallets" Icon={Wallet} onClick={() => onNavigate('wallet-detail')} tc={tc} />
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

        {/* ── 4. Plan + seats ──────────────────────────────────────── */}
        <section className="px-5 sm:px-6">
          <PlanStatusCard
            planKey={planKey ?? null}
            accountType="business"
            userId={userId}
            onManagePlans={() => onNavigate('pricing')}
            onUpgrade={onUpgrade}
          />
        </section>

        {/* ── 5. Accounts (Mercury rows) ───────────────────────────── */}
        <section className="px-5 sm:px-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>Accounts</h2>
            {walletsError && (
              <button
                onClick={loadWallets}
                className="text-[11px] text-[#C7FF00] font-semibold inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            )}
          </div>

          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
            {walletsLoading ? (
              [1, 2].map((i) => (
                <div key={i} className={`px-4 py-3.5 flex items-center gap-3 ${i > 1 ? `border-t ${tc.borderLight}` : ''}`}>
                  <div className={`w-9 h-9 rounded-full ${tc.bgAlt} animate-pulse flex-shrink-0`} />
                  <div className="flex-1">
                    <div className={`h-3 w-24 rounded ${tc.bgAlt} animate-pulse mb-1.5`} />
                    <div className={`h-2.5 w-16 rounded ${tc.bgAlt} animate-pulse`} />
                  </div>
                </div>
              ))
            ) : walletsError ? (
              <div className="px-4 py-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className={`text-xs ${tc.text}`}>{walletsError}</p>
              </div>
            ) : wallets.length === 0 ? (
              <button
                onClick={() => onNavigate('receive-money')}
                className={`w-full px-4 py-5 flex items-center gap-3 ${tc.hoverBg} text-left transition-colors`}
              >
                <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
                  <Wallet className={`w-4 h-4 ${tc.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${tc.text}`}>Open your first account</p>
                  <p className={`text-[11px] ${tc.textMuted}`}>BorderPay accounts available for your country.</p>
                </div>
                <ArrowRight className={`w-4 h-4 ${tc.textMuted}`} />
              </button>
            ) : (
              wallets.map((w, i) => (
                <button
                  key={w.currency}
                  onClick={() => onNavigate('wallet-detail')}
                  className={`w-full px-4 py-3.5 flex items-center gap-3 ${tc.hoverBg} transition-colors text-left ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}
                >
                  <div className="w-9 h-9 rounded-full bg-[#C7FF00]/15 text-[#C7FF00] flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0">
                    {w.currency.slice(0,3)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tc.text}`}>{w.currency} account</p>
                    <p className={`text-[11px] ${tc.textMuted}`}>Available</p>
                  </div>
                  <p className={`text-sm font-semibold ${tc.text} tabular-nums font-mono flex-shrink-0`}>
                    {fmt(w.balance, w.currency)}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        {/* ── 6. BorderPay infrastructure ──────────────────────────── */}
        <section className="px-5 sm:px-6 space-y-2.5">
          <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em] mb-3`}>
            Business infrastructure
          </h2>
          <BridgeKycStatusCard userId={userId} onStartVerification={() => onNavigate('kyc')} />
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
    </div>
  );
}

// ── BizChip ─────────────────────────────────────────────────────────────
// Outlined chip-style action button used in the BusinessDashboard quick-row.
// `primary` swaps the background to lime (used for "Team" so the team-mgmt
// surface gets visual priority for business owners).
function BizChip({
  label, Icon, onClick, primary, tc, disabled,
}: {
  label:    string;
  Icon:     React.ComponentType<{ className?: string }>;
  onClick:  () => void;
  primary?: boolean;
  tc:       ReturnType<typeof useThemeClasses>;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
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

export default BusinessDashboard;
