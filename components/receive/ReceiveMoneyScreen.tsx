/**
 * ReceiveMoneyScreen — single unified list of "places someone can pay you" that
 * reuses the SAME premium row + sheet UI as the Wallet tab. Tapping a row opens
 * either:
 *   • AccountDetailSheet — the "bank letter" for USD / EUR / GBP virtual accounts
 *   • WalletDetailSheet  — the stablecoin deposit address sheet
 *
 * No more BridgeVirtualAccountsCard / BridgeWalletsCard (those broke + their UI
 * had drifted from the Wallet tab). One source, one component, one design.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Inbox, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { useVerification } from '../../utils/verification/useVerification';
import { authAPI, supabase } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { FloatingBackButton } from '../common/FloatingBackButton';
import {
  AssetBadge, AccountDetailSheet, WalletDetailSheet, chainLabel, assetName,
} from '../dashboard/bridge/WalletVisuals';
import {
  bridgeVirtualAccountCurrenciesForCountry,
  type BridgeVirtualAccountCurrency,
} from '../../utils/compliance/partnerCountryPolicy';
import { friendlyError } from '../../utils/errors/friendlyError';
import { showToast } from '../common/StatusToast';

interface ReceiveMoneyScreenProps {
  onBack: () => void;
  /** Kept for caller compatibility; the new screen always shows everything. */
  preSelectedWalletId?: string;
}

interface StableRow { id: string; currency: string; chain: string; address: string; status: string }
interface VaRow     { id: string; currency: BridgeVirtualAccountCurrency; rail: string | null; status: string; account_details: any; bridge_virtual_account_id: string }

const CURRENCY_FULL_NAME: Record<string, string> = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
};
const RAIL_NAME: Record<string, string> = { USD: 'ACH / Wire', EUR: 'SEPA', GBP: 'Faster Payments' };

export function ReceiveMoneyScreen({ onBack }: ReceiveMoneyScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const storedUser = authAPI.getStoredUser() || {};
  const userId = (storedUser.id as string) || '';
  const country = (storedUser.country as string) || null;
  const verification = useVerification(userId);

  const availableVaCurrencies = useMemo(
    () => bridgeVirtualAccountCurrenciesForCountry(country),
    [country],
  );

  // ── Data (seeded from cache so the screen mounts instantly) ──────────────
  const [stables, setStables] = useState<StableRow[]>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_wallets_ind_v1') || '[]'); } catch { return []; }
  });
  const [vas, setVas] = useState<VaRow[]>(() => {
    try { return JSON.parse(localStorage.getItem('borderpay_va_ind_v1') || '[]'); } catch { return []; }
  });
  const [loading, setLoading] = useState(stables.length === 0 && vas.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const [selectedStable, setSelectedStable] = useState<StableRow | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try { await backendAPI.bridge.provisionStablecoins(); } catch { /* best-effort */ }
    try { await backendAPI.bridge.syncAccounts(); }        catch { /* best-effort */ }
    const [{ data: bw }, { data: bv }] = await Promise.all([
      supabase.from('bridge_wallets').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('bridge_virtual_accounts').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]);
    const sList = (bw as StableRow[]) ?? [];
    const vList = (bv as VaRow[]) ?? [];
    setStables(sList);
    setVas(vList);
    try { localStorage.setItem('borderpay_wallets_ind_v1', JSON.stringify(sList)); } catch { /* noop */ }
    try { localStorage.setItem('borderpay_va_ind_v1',      JSON.stringify(vList)); } catch { /* noop */ }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { if (verification.isVerified) refresh(); /* eslint-disable-next-line */ }, [userId, verification.isVerified]);

  // Missing VA currencies (the inline "Open X account" rows)
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
  if (!verification.isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <FloatingBackButton onBack={onBack} />
        <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
            {tt('receive.title', 'Receive funds')}
          </p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto mb-6 leading-relaxed`}>
              Complete identity verification to open accounts and stablecoin wallets others can pay you on.
            </p>
            <button onClick={onBack} className={`text-[12px] font-semibold ${tc.textSecondary} hover:${tc.text}`}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-floating-back pb-28">

        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('receive.title', 'Receive funds')}
          </p>
          <button onClick={refresh} aria-label="Refresh"
            className={`p-2 rounded-full ${tc.hoverBg} ${refreshing ? 'opacity-60' : ''}`}>
            <RefreshCw className={`w-4 h-4 ${tc.textMuted} ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Explainer */}
        <div className={`mb-5 rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5 flex items-start gap-3`}>
          <Inbox className="w-4 h-4 text-[#C7FF00] mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${tc.text}`}>How others pay you</p>
            <p className={`text-[11px] ${tc.textMuted} mt-0.5 leading-snug`}>
              Tap any account or stablecoin below to see the deposit details. Share them with the sender.
            </p>
          </div>
        </div>

        {/* Unified list — same rows/sheets as the Wallet tab */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('receive.payInto', 'Pay into')}
        </h2>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
          {loading ? (
            <div className="px-4 py-8 text-center">
              <Loader2 className={`w-5 h-5 ${tc.textMuted} animate-spin mx-auto`} />
            </div>
          ) : vas.length === 0 && stables.length === 0 && missingVa.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className={`text-sm ${tc.textMuted}`}>No accounts yet. Open one from the Wallet tab.</p>
            </div>
          ) : (
            <>
              {/* Fiat virtual accounts first */}
              {vas.map((v, i) => {
                const cur = String(v.currency).toUpperCase();
                return (
                  <button key={v.id} onClick={() => setSelectedVa(v)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}>
                    <AssetBadge symbol={cur} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] font-semibold ${tc.text} truncate`}>
                        {CURRENCY_FULL_NAME[cur] ?? cur} <span className={`text-xs font-medium ${tc.textMuted}`}>({RAIL_NAME[cur] ?? 'Bank transfer'})</span>
                      </div>
                      <div className={`text-[11px] ${tc.textMuted}`}>{cur} account · bank transfer</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted} hidden xs:inline`}>View details</span>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}

              {/* Stablecoins */}
              {stables.map((s, i) => {
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
                      <div className={`text-[11px] ${tc.textMuted}`}>{sym} · stablecoin deposit address</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted} hidden xs:inline`}>View address</span>
                    <ChevronRight className={`w-4 h-4 ${tc.textMuted} flex-shrink-0 ml-1`} />
                  </button>
                );
              })}

              {/* Inline "Open X account" rows for missing currencies */}
              {missingVa.map((c, i) => {
                const showDivider = vas.length > 0 || stables.length > 0 || i > 0;
                return (
                  <button key={`open-${c}`} disabled={creating === c} onClick={() => handleCreate(c)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${tc.hoverBg} ${showDivider ? `border-t ${tc.borderLight}` : ''} disabled:opacity-60`}>
                    <AssetBadge symbol={c} size={44} />
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
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Detail sheets — same components the Wallet tab uses */}
      <WalletDetailSheet open={!!selectedStable} onClose={() => setSelectedStable(null)}
        wallet={selectedStable ? { currency: selectedStable.currency, chain: selectedStable.chain, address: selectedStable.address } : null} />
      <AccountDetailSheet open={!!selectedVa} onClose={() => setSelectedVa(null)}
        va={selectedVa ? { currency: selectedVa.currency, rail: selectedVa.rail, status: selectedVa.status, account_details: selectedVa.account_details } : null} />
    </div>
  );
}

export default ReceiveMoneyScreen;
