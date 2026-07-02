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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shield, Inbox, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { authAPI } from '../../utils/supabase/client';
import { backendAPI } from '../../utils/api/backendAPI';
import { FloatingBackButton } from '../common/FloatingBackButton';
import {
  AssetBadge, AccountDetailSheet, WalletDetailSheet, chainLabel, assetName,
} from '../dashboard/bridge/WalletVisuals';
import { friendlyError } from '../../utils/errors/friendlyError';
import { showToast } from '../common/StatusToast';
import { financialCacheKey } from '../../utils/financial/cacheScope';

interface ReceiveMoneyScreenProps {
  onBack: () => void;
  /** Kept for caller compatibility; the new screen always shows everything. */
  preSelectedWalletId?: string;
}

interface StableRow { id: string; currency: string; chain: string; address: string; status: string }
interface VaRow     { id: string; currency: 'USD' | 'EUR' | 'GBP'; rail: string | null; status: string; account_details: any; bridge_virtual_account_id: string }

const CURRENCY_FULL_NAME: Record<string, string> = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound',
};
const RAIL_NAME: Record<string, string> = { USD: 'ACH / Wire', EUR: 'SEPA', GBP: 'Faster Payments' };

function isApproved(value?: string | null): boolean {
  if (typeof value !== 'string') return false;
  return ['approved', 'active', 'authorized', 'verified', 'completed', 'complete'].includes(value.toLowerCase());
}

function readCachedVerified(): boolean {
  try {
    const u = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    const accountType = String(u?.account_type || 'individual').toLowerCase();
    const kycApproved = isApproved(u?.bridge_kyc_status);
    const kybApproved = isApproved(u?.bridge_kyb_status);
    const accountApproved = isApproved(u?.bridge_account_status);
    return accountType === 'business'
      ? (kybApproved || kycApproved || accountApproved)
      : (kycApproved || accountApproved);
  } catch {
    return false;
  }
}

export function ReceiveMoneyScreen({ onBack }: ReceiveMoneyScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const storedUser = authAPI.getStoredUser() || {};
  const userId = (storedUser.id as string) || '';
  const [isVerified, setIsVerified] = useState<boolean>(() => readCachedVerified());

  const country = (storedUser.country as string | null | undefined) ?? null;
  const stableWalletsCacheKey = useMemo(
    () => financialCacheKey('borderpay_wallets_v1', { userId }),
    [userId],
  );
  const vaCacheKey = useMemo(
    () => financialCacheKey('borderpay_va_v1', { userId }),
    [userId],
  );
  const receiveRefreshTsKey = useMemo(
    () => financialCacheKey('borderpay_receive_refresh_ts_v1', { userId }),
    [userId],
  );

  // ── Data (seeded from cache so the screen mounts instantly) ──────────────
  const [stables, setStables] = useState<StableRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
      return Array.isArray(scoped) ? scoped : [];
    } catch { return []; }
  });
  const [vas, setVas] = useState<VaRow[]>(() => {
    try {
      const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
      return Array.isArray(scoped) ? scoped : [];
    } catch { return []; }
  });
  const stablesRef = useRef<StableRow[]>(stables);
  const vasRef = useRef<VaRow[]>(vas);
  const hasCachedReceiveRows = stables.length > 0 || vas.length > 0;
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const [flwReceive, setFlwReceive] = useState<{
    configured: boolean;
    receive_enabled: boolean;
    payout_enabled: boolean;
    methods: string[];
  } | null>(null);
  const [collectionAmount, setCollectionAmount] = useState<string>('');
  const [collectionCurrency, setCollectionCurrency] = useState<string>('NGN');
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [recentCollections, setRecentCollections] = useState<Array<{ id: string; status: string; amount: string; currency: string; txRef: string }>>([]);

  const [selectedStable, setSelectedStable] = useState<StableRow | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);

  useEffect(() => { stablesRef.current = stables; }, [stables]);
  useEffect(() => { vasRef.current = vas; }, [vas]);

  const shouldRunProviderSync = () => {
    try {
      const key = `borderpay_provider_sync_receive:${userId}`;
      const now = Date.now();
      const last = Number(localStorage.getItem(key) || '0');
      if (Number.isFinite(last) && now - last < 5 * 60 * 1000) return false;
      localStorage.setItem(key, String(now));
      return true;
    } catch {
      return true;
    }
  };

  const refresh = async (force = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const seededStables = stablesRef.current.length > 0 ? stablesRef.current : (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(stableWalletsCacheKey) || '[]');
        return Array.isArray(scoped) ? scoped : [];
      } catch { return []; }
    })();
    const seededVas = vasRef.current.length > 0 ? vasRef.current : (() => {
      try {
        const scoped = JSON.parse(localStorage.getItem(vaCacheKey) || '[]');
        return Array.isArray(scoped) ? scoped : [];
      } catch { return []; }
    })();
    const isColdStart = seededStables.length === 0 && seededVas.length === 0;
    setRefreshing(true);
    try {
      const last = Number(localStorage.getItem(receiveRefreshTsKey) || '0');
      if (!force && !isColdStart && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const routeData: any = await backendAPI.financial.getReceiveRouteData();
      const sList = (routeData?.data?.stablecoin_wallets as StableRow[]) ?? [];
      const vList = (routeData?.data?.virtual_accounts as VaRow[]) ?? [];
      setStables(sList);
      setVas(vList);
      try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(sList)); } catch { /* noop */ }
      try { localStorage.setItem(vaCacheKey, JSON.stringify(vList)); } catch { /* noop */ }
      try { localStorage.setItem(receiveRefreshTsKey, String(Date.now())); } catch { /* noop */ }
      // Heavy provider sync/provision runs after first paint; never blocks route render.
      if (shouldRunProviderSync()) {
        void Promise.allSettled([
          backendAPI.bridge.syncAccounts(),
        ]).then(async () => {
          try {
            const next: any = await backendAPI.financial.getReceiveRouteData();
            const nextStables = (next?.data?.stablecoin_wallets as StableRow[]) ?? [];
            const nextVas = (next?.data?.virtual_accounts as VaRow[]) ?? [];
            setStables(nextStables);
            setVas(nextVas);
            try { localStorage.setItem(stableWalletsCacheKey, JSON.stringify(nextStables)); } catch { /* noop */ }
            try { localStorage.setItem(vaCacheKey, JSON.stringify(nextVas)); } catch { /* noop */ }
          } catch {
            // keep first snapshot
          }
        });
      }
    } catch {
      // Keep cached data visible; refresh is best-effort.
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => { setIsVerified(readCachedVerified()); }, [userId]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const countryIso = String(country || '').toUpperCase();
        const r: any = await backendAPI.payouts.capabilities('payment_methods', countryIso ? { country: countryIso } : {});
        if (cancelled || !r?.success) return;
        const caps = (r?.data?.capabilities || {}) as any;
        const rawMethods = Array.isArray(r?.data?.payment_methods) ? r.data.payment_methods : [];
        const methods = rawMethods
          .map((m: any) => String(m?.name || m?.type || m?.method || m?.code || '').trim())
          .filter(Boolean);
        setFlwReceive({
          configured: Boolean(caps?.configured),
          receive_enabled: Boolean(caps?.receive_enabled),
          payout_enabled: Boolean(caps?.payout_enabled),
          methods,
        });
      } catch {
        if (!cancelled) setFlwReceive(null);
      }
    })();
    return () => { cancelled = true; };
  }, [country]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!flwReceive?.receive_enabled) return;
      try {
        const r: any = await backendAPI.payouts.collectionsList({ limit: 5 });
        if (cancelled || !r?.success) return;
        const raw = r?.data?.collections;
        const rows = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);
        const mapped = rows.map((row: any) => ({
          id: String(row?.id || row?.flw_ref || row?.tx_ref || '').trim(),
          status: String(row?.status || row?.data?.status || 'pending').toLowerCase(),
          amount: String(row?.amount || row?.charged_amount || row?.data?.amount || ''),
          currency: String(row?.currency || row?.data?.currency || ''),
          txRef: String(row?.tx_ref || row?.txRef || row?.reference || ''),
        })).filter((x: any) => x.id);
        setRecentCollections(mapped);
      } catch {
        if (!cancelled) setRecentCollections([]);
      }
    })();
    return () => { cancelled = true; };
  }, [flwReceive?.receive_enabled]);
  useEffect(() => {
    const prewarmKey = `borderpay_receive_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['wallet-detail', 'send-money', 'transactions', 'exchange', 'external-accounts'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 1000 });
          else setTimeout(warm, 220);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }

    if (isVerified) refresh();
    const onFocus = () => { if (isVerified) void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isVerified) void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  /* eslint-disable-next-line */ }, [userId, isVerified, receiveRefreshTsKey]);

  // Missing VA currencies (the inline "Open X account" rows)
  const collectionCurrencies = useMemo(() => {
    const fromPolicy = Array.isArray((flwReceive as any)?.currencies) ? (flwReceive as any).currencies : [];
    if (fromPolicy.length > 0) return fromPolicy.map((c: string) => String(c).toUpperCase());
    return ['NGN', 'KES', 'GHS', 'UGX', 'TZS', 'RWF', 'ZMW', 'ZAR'];
  }, [flwReceive]);

  const createCollection = async () => {
    const amount = Number(collectionAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast.error('Enter a valid collection amount.');
      return;
    }
    setCollectionBusy(true);
    try {
      const txRef = `bp-flw-col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const customerEmail = String(storedUser?.email || '').trim();
      const customerName = String(storedUser?.name || storedUser?.full_name || 'BorderPay User').trim();
      const r: any = await backendAPI.payouts.createCollection({
        amount,
        currency: collectionCurrency,
        tx_ref: txRef,
        payment_options: 'banktransfer,mobilemoney,card',
        customer: customerEmail ? { email: customerEmail, name: customerName } : { name: customerName },
        customizations: {
          title: 'BorderPay payment',
          description: 'Complete payment to fund your BorderPay wallet',
        },
        meta: {
          user_id: userId,
          flow: 'receive',
        },
      });
      if (!r?.success) {
        showToast.error(friendlyError(r?.error || 'Could not create collection request.'));
        return;
      }
      showToast.success('Collection request created.');
      setCollectionAmount('');
      const col = r?.data?.collection || {};
      const id = String(col?.id || col?.flw_ref || txRef);
      setRecentCollections((prev) => [
        {
          id,
          status: String(col?.status || 'pending').toLowerCase(),
          amount: String(col?.amount || amount),
          currency: String(col?.currency || collectionCurrency),
          txRef: String(col?.tx_ref || txRef),
        },
        ...prev,
      ].slice(0, 5));
    } finally {
      setCollectionBusy(false);
    }
  };

  // ── KYC gate ─────────────────────────────────────────────────────────────
  if (!isVerified) {
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
          <button onClick={() => refresh(true)} aria-label="Refresh"
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
            <p className={`text-[11px] ${tc.textMuted} mt-1 leading-snug`}>
              Funds received through USD/EUR/GBP receive rails settle to your wallet balance for spending.
            </p>
          </div>
        </div>
        {flwReceive && (
          <div className={`mb-5 rounded-2xl border ${tc.cardBorder} ${tc.card} px-4 py-3.5`}>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-sm font-semibold ${tc.text}`}>Local receive rails</p>
              <span className={`text-[10px] px-2 py-1 rounded-full ${flwReceive.receive_enabled ? 'bg-[#C7FF00]/15 text-[#C7FF00]' : 'bg-white/10 text-white/65'}`}>
                {flwReceive.receive_enabled ? 'Available' : 'Coming soon'}
              </span>
            </div>
            <p className={`text-[11px] ${tc.textMuted} leading-snug`}>
              {flwReceive.methods.length > 0
                ? flwReceive.methods.slice(0, 6).join(' · ')
                : 'Local rails will appear here when enabled for your account and corridor.'}
            </p>
            {flwReceive.receive_enabled && (
              <div className={`mt-3 pt-3 border-t ${tc.borderLight}`}>
                <p className={`text-[10px] uppercase tracking-[0.2em] ${tc.textMuted} mb-2`}>Create local collection</p>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                    placeholder="Amount"
                    className={`flex-1 rounded-xl px-3 py-2 text-sm ${tc.inputBg} border ${tc.borderLight} ${tc.text}`}
                  />
                  <select
                    value={collectionCurrency}
                    onChange={(e) => setCollectionCurrency(e.target.value)}
                    className={`rounded-xl px-3 py-2 text-sm ${tc.inputBg} border ${tc.borderLight} ${tc.text}`}
                  >
                    {collectionCurrencies.map((c: string) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={createCollection}
                  disabled={collectionBusy}
                  className="w-full h-10 rounded-xl bg-[#C7FF00] text-[#0B0E11] text-sm font-semibold disabled:opacity-50"
                >
                  {collectionBusy ? 'Creating…' : 'Create request'}
                </button>
                {recentCollections.length > 0 && (
                  <div className={`mt-3 rounded-xl border ${tc.borderLight} overflow-hidden`}>
                    {recentCollections.map((row, idx) => (
                      <div
                        key={row.id}
                        className={`px-3 py-2 text-xs flex items-center justify-between ${idx > 0 ? `border-t ${tc.borderLight}` : ''}`}
                      >
                        <span className={tc.text}>{row.currency} {row.amount}</span>
                        <span className={tc.textMuted}>{row.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Unified list — same rows/sheets as the Wallet tab */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('receive.payInto', 'Pay into')}
        </h2>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-6`}>
          {loading ? (
            <div className="px-4 py-8 text-center">
              <Loader2 className={`w-5 h-5 ${tc.textMuted} animate-spin mx-auto`} />
            </div>
          ) : vas.length === 0 && stables.length === 0 ? (
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

              {/* New account activation lives on dedicated Add Wallet screen. */}
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
