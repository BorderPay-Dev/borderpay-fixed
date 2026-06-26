import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCw, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';
import { friendlyErrorFor } from '../../utils/errors/friendlyError';
import { resolveFinancialCacheScope } from '../../utils/financial/cacheScope';
import { authAPI } from '../../utils/supabase/client';

interface ExchangeScreenProps {
  onBack: () => void;
}

interface RateRow {
  pair: string;
  base: string;
  quote: string;
  rate: number;
  source: 'live' | 'fallback';
}

interface StableWallet {
  id: string;
  bridge_wallet_id: string;
  currency: string;
  chain: string;
  balance?: number;
  address?: string | null;
  source?: 'wallet' | 'virtual_account';
}

const DEFAULT_RATE_ROWS: RateRow[] = [
  { pair: 'USD_NGN', base: 'USD', quote: 'NGN', rate: 1500, source: 'fallback' },
  { pair: 'USD_KES', base: 'USD', quote: 'KES', rate: 129, source: 'fallback' },
  { pair: 'EUR_USD', base: 'EUR', quote: 'USD', rate: 1.08, source: 'fallback' },
];

function fmtPair(pair: string): { base: string; quote: string } {
  const [base, quote] = pair.split('_');
  return { base: base || '?', quote: quote || '?' };
}

function inferChainFromCurrency(currency: string): string {
  const c = String(currency || '').toUpperCase();
  if (c === 'USDT') return 'tron';
  if (c === 'USDC') return 'base';
  return '';
}

function fmtCurrencyAmount(currency: string, amount: number): string {
  const c = String(currency || '').toUpperCase();
  const n = Number(amount || 0);
  if (c === 'USD') return `$${n.toFixed(2)}`;
  if (c === 'EUR') return `€${n.toFixed(2)}`;
  if (c === 'GBP') return `£${n.toFixed(2)}`;
  return `${n.toFixed(2)}`;
}

type CachedWalletRow = { currency: string; balance: number; bridge_wallet_id?: string };
function getKnownUserIdsForCache(): string[] {
  const ids = new Set<string>();
  try {
    const scope = resolveFinancialCacheScope();
    if (scope.userId && scope.userId !== 'anon') ids.add(scope.userId);
  } catch { /* ignore */ }
  try {
    const authUser = authAPI.getStoredUser();
    const authUserId = String(authUser?.id || '').trim();
    if (authUserId) ids.add(authUserId);
  } catch { /* ignore */ }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      const userId = String((parsed?.user || parsed?.currentSession?.user)?.id || '').trim();
      if (userId) ids.add(userId);
    }
  } catch { /* ignore */ }
  return Array.from(ids);
}

function readCachedDashboardWallets(): CachedWalletRow[] {
  try {
    const userIds = getKnownUserIdsForCache();
    const keys: string[] = [];
    for (const userId of userIds) {
      keys.push(`borderpay_dash_wallets_v1:${userId}`);
      keys.push(`borderpay_business_dash_wallets_v1:${userId}`);
      keys.push(`borderpay_snapshot_cache_v1:${userId}`);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      if (parsed?.snapshot && Array.isArray(parsed.snapshot?.data?.wallets) && parsed.snapshot.data.wallets.length > 0) {
        return parsed.snapshot.data.wallets;
      }
    }
  } catch { /* ignore cache read failures */ }
  return [];
}

function readCachedBalanceByCurrencyRows(): CachedWalletRow[] {
  try {
    const userIds = getKnownUserIdsForCache();
    for (const userId of userIds) {
      const raw = localStorage.getItem(`borderpay_wallet_balances_${userId}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      const rows = Object.entries(parsed).map(([currency, balance]) => ({
        currency: String(currency || '').toUpperCase(),
        balance: Number(balance || 0),
      }));
      if (rows.length > 0) return rows;
    }
  } catch { /* ignore */ }
  return [];
}

function readCachedVirtualAccounts(): Array<{ currency?: string; bridge_virtual_account_id?: string; id?: string }> {
  try {
    const userIds = getKnownUserIdsForCache();
    for (const userId of userIds) {
      const keys = [
        `borderpay_va_v1:${userId}`,
        `borderpay_snapshot_cache_v1:${userId}`,
      ];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        if (Array.isArray(parsed?.snapshot?.data?.virtual_accounts) && parsed.snapshot.data.virtual_accounts.length > 0) {
          return parsed.snapshot.data.virtual_accounts;
        }
      }
    }
  } catch { /* ignore */ }
  return [];
}

export function ExchangeScreen({ onBack }: ExchangeScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [rates, setRates] = useState<RateRow[]>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('borderpay_fx_rates_cache_v1') || 'null');
      if (cached && Array.isArray(cached.rates) && cached.rates.length > 0) {
        return cached.rates as RateRow[];
      }
    } catch { /* ignore malformed cache */ }
    return DEFAULT_RATE_ROWS;
  });
  const [rateSource, setRateSource] = useState<'live' | 'fallback'>('fallback');
  const [generated, setGenerated] = useState<string | null>(null);
  const [loadingRates, setLoadingRates] = useState(false);
  const [pairRate, setPairRate] = useState<number | null>(null);
  const [pairRateUpdatedAt, setPairRateUpdatedAt] = useState<string | null>(null);
  const [pairRateLoading, setPairRateLoading] = useState(false);

  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [stableWallets, setStableWallets] = useState<StableWallet[]>([]);
  const [hasVirtualAccount, setHasVirtualAccount] = useState(false);

  const [sourceWalletId, setSourceWalletId] = useState('');
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ transfer_id: string; state: string } | null>(null);

  const FX_RATES_CACHE_KEY = 'borderpay_fx_rates_cache_v1';
  const FX_ROUTE_CACHE_KEY = 'borderpay_fx_route_cache_v1';

  const selectedWallet = useMemo(
    () => stableWallets.find((w) => w.id === sourceWalletId) || null,
    [stableWallets, sourceWalletId],
  );
  const destinationWallets = useMemo(
    () => stableWallets.filter((w) => w.id !== sourceWalletId),
    [stableWallets, sourceWalletId],
  );
  const selectedDestinationWallet = useMemo(
    () => destinationWallets.find((w) => w.id === destinationWalletId) || null,
    [destinationWalletId, destinationWallets],
  );

  useEffect(() => {
    if (destinationWallets.length === 0) {
      if (destinationWalletId) setDestinationWalletId('');
      return;
    }
    if (!destinationWallets.some((w) => w.id === destinationWalletId)) {
      setDestinationWalletId(destinationWallets[0].id);
    }
  }, [destinationWalletId, destinationWallets]);

  const prerequisites = useMemo(() => ({
    wallet: stableWallets.length > 0,
    virtualAccount: hasVirtualAccount,
  }), [stableWallets.length, hasVirtualAccount]);

  const canExecute = Boolean(
    selectedWallet &&
    selectedDestinationWallet &&
    selectedWallet.id !== selectedDestinationWallet.id &&
    Number(amount) > 0 &&
    Number(amount) <= Number(selectedWallet.balance || 0) &&
    backendAPI.fx.isPairSupported(selectedWallet.currency, selectedDestinationWallet.currency) &&
    prerequisites.wallet &&
  );

  useEffect(() => {
    let cancelled = false;
    const loadPairRate = async () => {
      if (!selectedWallet || !selectedDestinationWallet) {
        setPairRate(null);
        setPairRateUpdatedAt(null);
        return;
      }
      const supported = backendAPI.fx.isPairSupported(
        selectedWallet.currency,
        selectedDestinationWallet.currency,
      );
      if (!supported) {
        setPairRate(null);
        setPairRateUpdatedAt(null);
        return;
      }
      setPairRateLoading(true);
      try {
        const r: any = await backendAPI.fx.getCurrentRate(
          selectedWallet.currency,
          selectedDestinationWallet.currency,
        );
        if (cancelled) return;
        if (r?.success && Number.isFinite(Number(r?.data?.rate))) {
          setPairRate(Number(r.data.rate));
          setPairRateUpdatedAt(r?.data?.updated_at || null);
        } else {
          setPairRate(null);
          setPairRateUpdatedAt(null);
        }
      } finally {
        if (!cancelled) setPairRateLoading(false);
      }
    };
    void loadPairRate();
    return () => { cancelled = true; };
  }, [selectedWallet?.currency, selectedDestinationWallet?.currency]);

  const loadRates = async (foreground: boolean = false) => {
    if (foreground) setLoadingRates(true);
    try {
      const r: any = await backendAPI.fx.getLiveRates();
      if (r?.success && r.data) {
        const ratesObj: Record<string, number> = r.data.rates || {};
        const rows: RateRow[] = Object.entries(ratesObj).map(([pair, rate]) => {
          const { base, quote } = fmtPair(pair);
          return { pair, base, quote, rate: Number(rate), source: r.data.source ?? 'fallback' };
        });
        setRates(rows);
        setRateSource(r.data.source ?? 'fallback');
        setGenerated(r.data.generated_at ?? null);
        try {
          localStorage.setItem(FX_RATES_CACHE_KEY, JSON.stringify({
            rates: rows,
            source: r.data.source ?? 'fallback',
            generated: r.data.generated_at ?? null,
          }));
        } catch { /* ignore cache write */ }
      }
    } finally {
      if (foreground) setLoadingRates(false);
    }
  };

  const loadSnapshot = async (foreground: boolean = false) => {
    if (foreground) setSnapshotLoading(true);
    try {
      // Use the exact same live route source as WalletScreen first.
      const routeRes: any = await backendAPI.financial.getWalletRouteData();
      const routeData = routeRes?.success ? routeRes.data : null;
      const snapshotRes: any = routeData ? null : await backendAPI.financial.getSnapshot(20);
      const snapshotData = (!routeData && snapshotRes?.success) ? snapshotRes.data : null;

      const stableRows = Array.isArray(routeData?.stablecoin_wallets)
        ? routeData.stablecoin_wallets
        : (Array.isArray(snapshotData?.stablecoin_wallets) ? snapshotData.stablecoin_wallets : []);
      const vaRows = Array.isArray(routeData?.virtual_accounts)
        ? routeData.virtual_accounts
        : (Array.isArray(snapshotData?.virtual_accounts) ? snapshotData.virtual_accounts : []);

      const cachedDashWallets = readCachedDashboardWallets();
      const cachedBalanceRows = readCachedBalanceByCurrencyRows();
      const walletsRes: any = await backendAPI.wallets.getWallets();
      const walletRows = (walletsRes?.success && Array.isArray(walletsRes?.data?.wallets))
        ? walletsRes.data.wallets
        : (Array.isArray(routeData?.wallets)
          ? routeData.wallets
          : (Array.isArray(snapshotData?.wallets)
            ? snapshotData.wallets
            : (cachedDashWallets.length > 0 ? cachedDashWallets : cachedBalanceRows)));

      const stableFromBridge: StableWallet[] = stableRows
        .map((r: any) => ({
          id: String(r?.bridge_wallet_id || r?.wallet_id || r?.id || ''),
          bridge_wallet_id: String(r?.bridge_wallet_id || r?.wallet_id || ''),
          currency: String(r?.currency || '').toUpperCase(),
          chain: String(r?.chain || '').toLowerCase(),
          balance: Number(r?.balance || 0),
          address: r?.address || null,
        }))
        .filter((r: StableWallet) => !!r.currency);

      const byCurrency = new Map<string, StableWallet>();
      for (const row of stableFromBridge) {
        byCurrency.set(row.currency, { ...row, source: 'wallet' });
      }
      for (const w of walletRows) {
        const currency = String((w as any)?.currency || '').toUpperCase();
        if (!currency) continue;
        const balance = Number((w as any)?.balance || 0);
        if (!Number.isFinite(balance)) continue;
        const bridgeWalletId = String((w as any)?.bridge_wallet_id || '');
        const existing = byCurrency.get(currency);
        if (existing) {
          if (!existing.bridge_wallet_id && bridgeWalletId) existing.bridge_wallet_id = bridgeWalletId;
          if (!existing.chain) existing.chain = inferChainFromCurrency(currency);
          existing.balance = balance;
          if (!existing.id) existing.id = existing.bridge_wallet_id || `wallet:${currency}`;
          existing.source = 'wallet';
          continue;
        }
        byCurrency.set(currency, {
          id: bridgeWalletId || `wallet:${currency}`,
          bridge_wallet_id: bridgeWalletId,
          currency,
          chain: inferChainFromCurrency(currency),
          balance,
          address: null,
          source: 'wallet',
        });
      }
      // Include fiat wallet universe from Virtual Accounts so FX selector
      // matches Wallet/Receive even when a fiat balance is currently zero.
      for (const va of vaRows) {
        const currency = String((va as any)?.currency || '').toUpperCase();
        if (!currency) continue;
        const existing = byCurrency.get(currency);
        if (existing) {
          if (!existing.id) existing.id = String((va as any)?.bridge_virtual_account_id || (va as any)?.id || `va:${currency}`);
          if (!existing.source) existing.source = 'virtual_account';
          continue;
        }
        const mappedBal = Number((walletRows as any[]).find((w: any) => String(w?.currency || '').toUpperCase() === currency)?.balance || 0);
        byCurrency.set(currency, {
          id: String((va as any)?.bridge_virtual_account_id || (va as any)?.id || `va:${currency}`),
          bridge_wallet_id: '',
          currency,
          chain: '',
          balance: Number.isFinite(mappedBal) ? mappedBal : 0,
          address: null,
          source: 'virtual_account',
        });
      }
      const wallets: StableWallet[] = Array.from(byCurrency.values())
        .filter((w) => !!w.currency);

      // Paint wallets first from route/snapshot data.
      setStableWallets(wallets);
      setHasVirtualAccount(vaRows.length > 0);
      if (!sourceWalletId && wallets[0]) setSourceWalletId(wallets[0].id);
      if (!destinationWalletId && wallets.length > 1) setDestinationWalletId(wallets[1].id);
      try {
        localStorage.setItem(FX_ROUTE_CACHE_KEY, JSON.stringify({
          wallets,
          hasVirtualAccount: vaRows.length > 0,
        }));
      } catch { /* ignore cache write */ }
    } finally {
      if (foreground) setSnapshotLoading(false);
    }
  };

  useEffect(() => {
    let hasCachedRates = false;
    let hasCachedRoute = false;
    try {
      const cached = JSON.parse(localStorage.getItem(FX_RATES_CACHE_KEY) || 'null');
      if (cached && Array.isArray(cached.rates) && cached.rates.length > 0) {
        hasCachedRates = true;
        setRates(cached.rates);
        setRateSource(cached.source ?? 'fallback');
        setGenerated(cached.generated ?? null);
        setLoadingRates(false);
      }
    } catch { /* ignore malformed cache */ }
    try {
      const cachedRoute = JSON.parse(localStorage.getItem(FX_ROUTE_CACHE_KEY) || 'null');
      if (cachedRoute && Array.isArray(cachedRoute.wallets)) {
        hasCachedRoute = true;
        setStableWallets(cachedRoute.wallets);
        setHasVirtualAccount(Boolean(cachedRoute.hasVirtualAccount));
        if (!sourceWalletId && cachedRoute.wallets[0]) setSourceWalletId(cachedRoute.wallets[0].id);
        if (!destinationWalletId && cachedRoute.wallets[1]) setDestinationWalletId(cachedRoute.wallets[1].id);
        setSnapshotLoading(false);
      }
    } catch { /* ignore malformed cache */ }
    // First-open fast path: hydrate selector from wallet caches even when FX
    // route cache does not exist yet.
    if (!hasCachedRoute) {
      try {
        const walletRows = readCachedDashboardWallets();
        const balanceRows = readCachedBalanceByCurrencyRows();
        const vaRows = readCachedVirtualAccounts();
        const walletSource = walletRows.length > 0 ? walletRows : balanceRows;
        const seen = new Set<string>();
        const quickWallets: StableWallet[] = [];
        for (const row of walletSource) {
          const currency = String((row as any)?.currency || '').toUpperCase();
          if (!currency || seen.has(currency)) continue;
          seen.add(currency);
          quickWallets.push({
            id: String((row as any)?.bridge_wallet_id || `wallet:${currency}`),
            bridge_wallet_id: String((row as any)?.bridge_wallet_id || ''),
            currency,
            chain: inferChainFromCurrency(currency),
            balance: Number((row as any)?.balance || 0),
            address: null,
            source: 'wallet',
          });
        }
        for (const va of vaRows) {
          const currency = String((va as any)?.currency || '').toUpperCase();
          if (!currency || seen.has(currency)) continue;
          seen.add(currency);
          quickWallets.push({
            id: String((va as any)?.bridge_virtual_account_id || (va as any)?.id || `va:${currency}`),
            bridge_wallet_id: '',
            currency,
            chain: '',
            balance: 0,
            address: null,
            source: 'virtual_account',
          });
        }
        if (quickWallets.length > 0) {
          setStableWallets(quickWallets);
          if (!sourceWalletId && quickWallets[0]) setSourceWalletId(quickWallets[0].id);
          if (!destinationWalletId && quickWallets[1]) setDestinationWalletId(quickWallets[1].id);
          setSnapshotLoading(false);
          hasCachedRoute = true;
        }
      } catch { /* noop */ }
    }
    loadRates(false);
    loadSnapshot(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const executeFxTransfer = async () => {
    if (!canExecute || !selectedWallet || !selectedDestinationWallet) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const r: any = await backendAPI.fx.convert({
        amount: Number(amount),
        idempotency_key: crypto.randomUUID(),
        source: {
          payment_rail: 'bridge_wallet',
          currency: selectedWallet.currency,
          chain: selectedWallet.chain,
          bridge_wallet_id: selectedWallet.bridge_wallet_id,
        },
        destination: {
          payment_rail: 'bridge_wallet',
          currency: selectedDestinationWallet.currency,
          chain: selectedDestinationWallet.chain,
          bridge_wallet_id: selectedDestinationWallet.bridge_wallet_id,
        },
      });
      if (r?.success && r?.data?.transfer_id) {
        setSubmitResult({ transfer_id: r.data.transfer_id, state: r.data.state || 'pending' });
      } else {
        setSubmitError(friendlyErrorFor(r?.error, 'fx', 'Unable to run FX transfer right now. Please try again.'));
      }
    } catch (e: any) {
      setSubmitError(friendlyErrorFor(e, 'fx', 'Unable to run FX transfer right now. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-floating-back pb-10">
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('exchange.title', 'Exchange')}
          </p>
          <button
            onClick={() => { loadRates(true); loadSnapshot(true); }}
            aria-label="Refresh"
            className={`p-1.5 rounded-full ${tc.hoverBg} transition-colors`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${tc.textMuted} ${(loadingRates || snapshotLoading) ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] px-5 py-6 mb-6">
          <div className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-[#C7FF00] opacity-[0.08] blur-3xl" />
          <div className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#C7FF00]/15 mb-3">
            <Sparkles className="w-3 h-3 text-[#C7FF00]" />
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#C7FF00]">FX orchestration</span>
          </div>
          <h1 className="relative text-white font-semibold tracking-tight text-2xl sm:text-3xl mb-2">
            FX conversion
          </h1>
          <p className="relative text-sm text-white/60 max-w-xl leading-relaxed">
            Execution path: Source wallet → transfer orchestration → Destination wallet.
            Virtual accounts handle inbound fiat funding; conversion happens wallet-to-wallet.
          </p>
        </div>

        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 mb-4`}>
          <p className={`text-xs font-semibold ${tc.text} mb-2`}>Prerequisites</p>
          <div className="space-y-1.5 text-xs">
            <div className={`flex items-center gap-2 ${prerequisites.wallet ? 'text-emerald-400' : tc.textMuted}`}>
              {prerequisites.wallet ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              Wallet
            </div>
            <div className={`flex items-center gap-2 ${prerequisites.virtualAccount ? 'text-emerald-400' : tc.textMuted}`}>
              {prerequisites.virtualAccount ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              Virtual Account (for fiat onramp step)
            </div>
          </div>
        </div>

        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 mb-6`}>
          <p className={`text-xs font-semibold ${tc.text} mb-3`}>Execute conversion</p>

          <label className={`block text-[11px] ${tc.textMuted} mb-1`}>Source wallet</label>
          <select
            value={sourceWalletId}
            onChange={(e) => setSourceWalletId(e.target.value)}
            className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} mb-3`}
          >
            {stableWallets.length === 0 ? <option value="">You don't have any wallets with available balances to convert.</option> : null}
            {stableWallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.currency} — {fmtCurrencyAmount(w.currency, Number(w.balance || 0))}
              </option>
            ))}
          </select>

          <label className={`block text-[11px] ${tc.textMuted} mb-1`}>Destination wallet</label>
          <select
            value={destinationWalletId}
            onChange={(e) => setDestinationWalletId(e.target.value)}
            className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} mb-3`}
          >
            {destinationWallets.length === 0 ? <option value="">Choose a different source wallet first.</option> : null}
            {destinationWallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.currency} — {fmtCurrencyAmount(w.currency, Number(w.balance || 0))}
              </option>
            ))}
          </select>

          <label className={`block text-[11px] ${tc.textMuted} mb-1`}>Amount</label>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} mb-3`}
          />

          {selectedWallet && selectedDestinationWallet && !backendAPI.fx.isPairSupported(selectedWallet.currency, selectedDestinationWallet.currency) && (
            <p className="mb-3 text-xs text-amber-400">
              This pair is currently unavailable. Supported pairs: USD↔BRL, USD↔COP, USD↔EUR, USD↔GBP, USD↔MXN, USD↔USDT.
            </p>
          )}

          {selectedWallet && selectedDestinationWallet && backendAPI.fx.isPairSupported(selectedWallet.currency, selectedDestinationWallet.currency) && (
            <p className={`mb-3 text-xs ${tc.textMuted}`}>
              {pairRateLoading
                ? 'Fetching current exchange rate…'
                : pairRate
                  ? `Current rate: 1 ${selectedWallet.currency} = ${pairRate.toFixed(pairRate >= 100 ? 2 : 6)} ${selectedDestinationWallet.currency}${pairRateUpdatedAt ? ` · ${new Date(pairRateUpdatedAt).toLocaleTimeString()}` : ''}`
                  : 'Current exchange rate unavailable. You can retry.'}
            </p>
          )}

          <button
            onClick={executeFxTransfer}
            disabled={!canExecute || submitting}
            className="w-full py-3 rounded-xl bg-[#C7FF00] text-black font-semibold text-sm disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Run conversion'}
          </button>

          {selectedWallet && Number(amount || 0) > Number(selectedWallet.balance || 0) && (
            <p className="mt-2 text-xs text-amber-400">
              Insufficient {selectedWallet.currency} balance for this conversion amount.
            </p>
          )}

          {submitError && <p className="mt-2 text-xs text-red-400">{submitError}</p>}
          {submitResult && (
            <p className="mt-2 text-xs text-emerald-400">
              Transfer {submitResult.transfer_id} created ({submitResult.state})
            </p>
          )}
        </div>

        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          Indicative rates
        </h2>
        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {rates.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className={`text-sm ${tc.textMuted}`}>No rates available right now.</p>
            </div>
          ) : (
            rates.map((r, i) => (
              <div
                key={r.pair}
                className={`px-4 py-3.5 flex items-center justify-between ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center`}>
                    <ArrowRightLeft className={`w-4 h-4 ${tc.text}`} />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${tc.text}`}>{r.base} / {r.quote}</p>
                    <p className={`text-[10px] ${tc.textMuted}`}>1 {r.base}</p>
                  </div>
                </div>
                <p className={`text-sm font-semibold tabular-nums font-mono ${tc.text}`}>
                  {r.rate.toFixed(r.rate >= 100 ? 2 : 4)} {r.quote}
                </p>
              </div>
            ))
          )}
        </div>

        <p className={`text-[10px] ${tc.textMuted} mt-3 px-1 leading-snug`}>
          {rateSource === 'fallback' ? 'Indicative fallback rates.' : 'Live indicative rates.'}
          {generated && ' · '}
          {generated && new Date(generated).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export default ExchangeScreen;
