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
import { supabase } from '../../utils/supabase/client';
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

  // ── Data ─────────────────────────────────────────────────────────────────
  const [stables, setStables] = useState<StableRow[]>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_wallets_ind_v1') || '[]'); } catch { return []; }
  });
  const [vas, setVas] = useState<VaRow[]>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_va_ind_v1') || '[]'); } catch { return []; }
  });
  const [totalUsd, setTotalUsd] = useState<number>(() => {
    try { const r = localStorage.getItem(`borderpay_wallet_total_${userId}`); return r ? Number(r) : 0; } catch { return 0; }
  });
  const [loading, setLoading] = useState(stables.length === 0 && vas.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const [selectedStable, setSelectedStable] = useState<StableRow | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    // Provision base stablecoins + mirror Bridge → local (both idempotent).
    try { await backendAPI.bridge.provisionStablecoins(); } catch { /* best-effort */ }
    try { await backendAPI.bridge.syncAccounts(); } catch { /* best-effort */ }

    const [{ data: bw }, { data: bv }, { data: bal }] = await Promise.all([
      supabase.from('bridge_wallets').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('bridge_virtual_accounts').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('bridge_virtual_account_balances').select('available_balance_minor, currency').eq('user_id', userId),
    ]);
    const sList = (bw as StableRow[]) ?? [];
    const vList = (bv as VaRow[]) ?? [];
    setStables(sList);
    setVas(vList);
    try { localStorage.setItem('borderpay_wallets_ind_v1', JSON.stringify(sList)); } catch { /* noop */ }
    try { localStorage.setItem('borderpay_va_ind_v1',      JSON.stringify(vList)); } catch { /* noop */ }

    if (Array.isArray(bal)) {
      const usdMinor = bal.filter((r: any) => r.currency === 'USD')
        .reduce((s: number, r: any) => s + Number(r.available_balance_minor || 0), 0);
      const tot = usdMinor / 100;
      setTotalUsd(tot);
      try { localStorage.setItem(`borderpay_wallet_total_${userId}`, String(tot)); } catch { /* noop */ }
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { if (isVerified) refresh(); /* eslint-disable-next-line */ }, [userId, isVerified]);

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

        {/* ── Total balance hero ─────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] px-5 py-5 mb-5">
          <div className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-[#C7FF00] opacity-[0.06] blur-3xl" />
          <p className="relative text-[10px] uppercase tracking-[0.18em] font-semibold text-white/40 mb-1.5">
            {tt('wallet.totalBalance', 'Total balance (USD)')}
          </p>
          <div className="relative flex items-end gap-2">
            <h1 className="text-white font-bold tracking-tight tabular-nums leading-none text-[38px] sm:text-[46px]">
              {balanceHidden ? <span>••••••</span> : (
                <>
                  <span className="text-xl sm:text-2xl text-white/50 mr-1 align-top">$</span>
                  {balances[0]}
                  <span className="text-xl sm:text-2xl text-white/50">.{balances[1]}</span>
                </>
              )}
            </h1>
            <button onClick={() => { const n = !balanceHidden; setBalanceHidden(n); updatePrefs({ hide_balance: n }); }}
              aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
              className="ml-1 mb-1 p-1.5 rounded-full hover:bg-white/[0.06] transition-colors">
              {balanceHidden ? <Eye className="w-4 h-4 text-white/50" /> : <EyeOff className="w-4 h-4 text-white/50" />}
            </button>
          </div>
          <p className="relative text-[11px] text-white/40 mt-1.5">
            Across your accounts and stablecoins
          </p>

          {/* Quick actions */}
          <div className="relative grid grid-cols-4 gap-2 mt-5">
            <QuickAction icon={ArrowUpRight}  label="Send"    onClick={() => onNavigate?.('send-money')}    tc={tc} />
            <QuickAction icon={ArrowDownLeft} label="Receive" onClick={() => onNavigate?.('receive-money')} tc={tc} />
            <QuickAction icon={Plus}          label="Deposit" onClick={() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }} tc={tc} />
            <QuickAction icon={RefreshCw}     label="Convert" onClick={() => onNavigate?.('exchange')}      tc={tc} />
          </div>
        </div>

        {/* ── Balances list ──────────────────────────────────────────────── */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('wallet.balances', 'Balances')}
        </h2>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
          {loading ? (
            <div className="px-4 py-8 text-center">
              <Loader2 className={`w-5 h-5 ${tc.textMuted} animate-spin mx-auto`} />
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
                        {cur === 'USD' ? '$0.00' : cur === 'EUR' ? '€0.00' : cur === 'GBP' ? '£0.00' : `0.00 ${cur}`}
                      </div>
                      <div className={`text-[10px] ${tc.textMuted} uppercase tracking-wider`}>View details</div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}
              {/* Stablecoins */}
              {stables.map((s, i) => {
                // Defensive: a sync glitch once left rows with empty currency.
                // Always recover something readable so the row never renders
                // as just "(Tron)" / "(Base)".
                const rawSym = String(s.currency || '').toUpperCase();
                const sym = rawSym || (String(s.chain).toLowerCase() === 'tron' ? 'USDT' : 'USDC');
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
                        $0.00
                      </div>
                      <div className={`text-[11px] ${tc.textMuted}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        0.00 {sym}
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
