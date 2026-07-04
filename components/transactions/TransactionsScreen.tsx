/**
 * BorderPay Africa - Transactions Screen
 * Complete transaction history with filters, export, and search
 * i18n + theme-aware
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Filter, Download, Search, ArrowUpRight, ArrowDownLeft, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { txDirection } from '../../utils/transactions/direction';
import { SkeletonRows } from '../common/Skeleton';
import { ErrorState } from '../common/ErrorState';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { sanitizeCustomerFacingText } from '../../utils/presentation/customerBranding';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface TransactionsScreenProps {
  userId: string;
  customerId?: string;
  onBack: () => void;
}

interface Transaction {
  id: string;
  // DB transaction_type enum (deposit/withdrawal/transfer/...); direction is
  // derived via txDirection(), not assumed to be credit/debit.
  type: string;
  amount: number;
  currency: string;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
  recipient?: string;
  sender?: string;
  metadata?: any;
}

const TX_CACHE_KEY = 'borderpay_tx_history_v1';
const TX_REFRESH_TS_KEY = 'borderpay_tx_refresh_ts_v1';
const DASH_RECENT_TX_KEY = 'borderpay_dash_recent_tx_v1';
const BIZ_DASH_TX_KEY = 'borderpay_business_dash_tx_v1';
const TX_FETCH_TIMEOUT_MS = 1400;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function normalizeTxRows(rows: any[]): Transaction[] {
  return rows
    .map((r: any) => ({
      id: String(r?.id || ''),
      type: String(r?.type || r?.transaction_type || ''),
      amount: Number(r?.amount || 0),
      currency: String(r?.currency || '').toUpperCase(),
      description: String(r?.description || r?.memo || 'Transaction'),
      status: (String(r?.status || 'pending').toLowerCase() as Transaction['status']),
      created_at: String(r?.created_at || new Date().toISOString()),
      recipient: r?.recipient || undefined,
      sender: r?.sender || undefined,
      metadata: r?.metadata || undefined,
    }))
    .filter((r: Transaction) => !!r.id);
}
function readTxCache(cacheKey: string, userId: string): Transaction[] {
  try {
    const raw = localStorage.getItem(cacheKey);
    const primary = raw ? JSON.parse(raw) : [];
    if (Array.isArray(primary) && primary.length > 0) return primary;
  } catch { /* continue to fallback */ }
  try {
    const recent = JSON.parse(localStorage.getItem(DASH_RECENT_TX_KEY) || '[]');
    if (Array.isArray(recent) && recent.length > 0) return normalizeTxRows(recent);
    const bizKey = financialCacheKey(BIZ_DASH_TX_KEY, { userId, accountType: 'business' });
    const biz = JSON.parse(localStorage.getItem(bizKey) || '[]');
    if (Array.isArray(biz) && biz.length > 0) return normalizeTxRows(biz);
  } catch { /* noop */ }
  return [];
}

export function TransactionsScreen({ userId, customerId: _customerId, onBack }: TransactionsScreenProps) {
  const cacheKey = financialCacheKey(TX_CACHE_KEY, { userId });
  const refreshTsKey = financialCacheKey(TX_REFRESH_TS_KEY, { userId });
  const seededRows = readTxCache(cacheKey, userId);
  useEffect(() => {
    navPerfTrackCache('transactions', seededRows.length > 0);
  }, [seededRows.length]);
  // Seed from cache so the history paints instantly on open, then refreshes.
  const [transactions, setTransactions] = useState<Transaction[]>(() => seededRows);
  const transactionsRef = useRef<Transaction[]>(seededRows);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const refreshInFlightRef = useRef(false);
  const { t, language } = useThemeLanguage();
  const tc = useThemeClasses();
  const snapshotReader = backendAPI.financial.getSnapshot;
  void snapshotReader;

  useEffect(() => {
    loadTransactions();
    // Warm common next hops from Activity so drawer transitions feel instant.
    const prewarmKey = `borderpay_transactions_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['settings', 'profile', 'notifications', 'team'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 900 });
          else setTimeout(warm, 120);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }
    const onFocus = () => { void loadTransactions(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadTransactions();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Filter is applied client-side below; avoid refetch on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTransactions = async (force = false) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const hasCachedRows = transactionsRef.current.length > 0;
    
    setLoadError(false);
    // Re-open optimization: avoid hitting the API on every fast route hop.
    // Keep cache hot and refresh at most every 45s per user/session.
    try {
      const last = Number(localStorage.getItem(refreshTsKey) || '0');
      if (!force && hasCachedRows && Number.isFinite(last) && Date.now() - last < 45_000) {
        setLoading(false);
        return;
      }
    } catch { /* noop */ }
    // Preserve cached rows during refresh; only show skeleton on cold start.
    try {
      // Phase 2 P1: read directly from `public.transactions` via the
      // canonical, RLS-safe getTransactions(). The previous "try
      // get-customer-transactions first, then fall back" dance was
      // wasted work — `get-customer-transactions` is not deployed
      // (production logs: `POST 404 .../get-customer-transactions`
      // with deployment_id=null), so every page-load took the 404
      // round-trip before falling back. Filtering by `filterType`
      // happens client-side alongside the existing search filter
      // (same idiom as `filteredTransactions` below).
      const result = await withTimeout(
        backendAPI.transactions.getTransactions(100, 0),
        TX_FETCH_TIMEOUT_MS,
        { success: false, error: 'request_timeout' } as any
      );
      if (result.success && result.data) {
        const txns = (result.data as any).transactions || [];
        const list = Array.isArray(txns) ? txns : [];
        setTransactions(list);
        try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch { /* noop */ }
        try { localStorage.setItem(refreshTsKey, String(Date.now())); } catch { /* noop */ }
      } else if (transactionsRef.current.length === 0) {
        // Only surface an error if we have nothing cached to show.
        setLoadError(true);
      }
    } catch (error) {
      if (transactionsRef.current.length === 0) setLoadError(true);
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
    }
  };

  const handleExport = async (_format: 'csv' | 'pdf' | 'excel') => {
    // Phase 2 P1: export is intentionally disabled. The
    // `export-transactions` edge function is not deployed (same drift
    // class as `get-wallets`/`get-transactions`), and clicking export
    // would otherwise return a 404 toast. Gating with a clean
    // "coming soon" toast until the export pipeline is built. When
    // the function ships, restore the original implementation in
    // git history and remove this gate.
    toast.message('Transaction export is coming soon.');
    setShowFilters(false);
  };

  const filteredTransactions = transactions.filter(txn => {
    // Apply type filter (was previously sent as a filter arg to the
    // never-deployed `get-customer-transactions`; now applied locally).
    if (filterType !== 'all' && txDirection(txn) !== filterType) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const safeDescription = sanitizeCustomerFacingText(txn.description);
    return (
      safeDescription.toLowerCase().includes(q) ||
      (txn.recipient?.toLowerCase() ?? '').includes(q) ||
      (txn.sender?.toLowerCase()    ?? '').includes(q)
    );
  });

  // Locale mapping for date formatting
  const localeMap: Record<string, string> = {
    en: 'en-US', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', sw: 'sw-KE',
  };
  const dateLocale = localeMap[language] || 'en-US';

  const groupedTransactions = filteredTransactions.reduce((groups, txn) => {
    const date = new Date(txn.created_at).toLocaleDateString(dateLocale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(txn);
    return groups;
  }, {} as Record<string, Transaction[]>);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return t('transactions.completed');
      case 'pending': return t('transactions.pending');
      case 'failed': return t('transactions.failed');
      default: return status;
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} ${tc.text} pb-safe`}>
      {/* Inline eyebrow + filter toggle. AppShell owns the top chrome
          for top-level routes; no duplicate sticky header here. */}
      <div className="max-w-2xl mx-auto px-5 pt-5 flex items-center justify-between">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
          {t('transactions.title')}
        </p>
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-label="Filters"
          className={`p-2 -mr-2 rounded-full ${tc.hoverBg} transition-colors`}
        >
          <Filter size={16} className={tc.text} />
        </button>
      </div>
      <div className="max-w-2xl mx-auto">

        {/* Search Bar */}
        <div className="px-5 pt-4 pb-2">
          <div className="relative">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${tc.textSecondary}`} size={20} />
            <input
              type="text"
              placeholder={t('transactions.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full ${tc.inputBg} rounded-2xl pl-12 pr-4 py-3 placeholder:${tc.textSecondary} focus:outline-none focus:border-[#C7FF00]/50`}
            />
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-6 pb-4 space-y-3"
          >
            {/* Filter Type */}
            <div>
              <p className={`bp-text-small ${tc.textSecondary} mb-2`}>{t('transactions.txType')}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-4 py-2 rounded-full bp-text-small font-semibold transition-all ${
                    filterType === 'all'
                      ? 'bg-[#C7FF00] text-black'
                      : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                  }`}
                >
                  {t('transactions.all')}
                </button>
                <button
                  onClick={() => setFilterType('credit')}
                  className={`px-4 py-2 rounded-full bp-text-small font-semibold transition-all ${
                    filterType === 'credit'
                      ? 'bg-[#C7FF00] text-black'
                      : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                  }`}
                >
                  {t('transactions.received')}
                </button>
                <button
                  onClick={() => setFilterType('debit')}
                  className={`px-4 py-2 rounded-full bp-text-small font-semibold transition-all ${
                    filterType === 'debit'
                      ? 'bg-[#C7FF00] text-black'
                      : `${tc.card} ${tc.textSecondary} ${tc.hoverBg}`
                  }`}
                >
                  {t('transactions.sent')}
                </button>
              </div>
            </div>

            {/* Export Options */}
            <div>
              <p className={`bp-text-small ${tc.textSecondary} mb-2`}>{t('transactions.export')}</p>
              <div className="flex gap-2">
                {(['csv', 'pdf', 'excel'] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => handleExport(format)}
                    disabled={exporting}
                    className={`px-4 py-2 rounded-full ${tc.card} ${tc.textSecondary} ${tc.hoverBg} bp-text-small font-semibold flex items-center gap-2 disabled:opacity-50`}
                  >
                    <Download size={16} />
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        {loadError ? (
          <ErrorState
            variant="server"
            title={t('transactions.title')}
            message="Could not load your transactions. Please try again."
            onRetry={() => loadTransactions(true)}
            compact
          />
        ) : loading && transactions.length === 0 ? (
          <SkeletonRows count={6} />
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-12">
            <Calendar size={48} className={`${tc.textMuted} mx-auto mb-4`} />
            <p className={`bp-text-body ${tc.textSecondary}`}>{t('transactions.noTransactions')}</p>
            <p className={`bp-text-small ${tc.textMuted}`}>{t('transactions.historyHere')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTransactions).map(([date, txns]) => (
              <div key={date}>
                <h3 className={`bp-text-small ${tc.textSecondary} mb-3`}>{date}</h3>
                <div className="space-y-2">
                  {txns.map((txn) => (
                    <div
                      key={txn.id}
                      className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 ${tc.hoverBg} transition-colors cursor-pointer`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          txDirection(txn) === 'credit'
                            ? 'bg-green-500/20'
                            : 'bg-red-500/20'
                        }`}>
                          {txDirection(txn) === 'credit' ? (
                            <ArrowDownLeft size={20} className="text-green-500" />
                          ) : (
                            <ArrowUpRight size={20} className="text-red-500" />
                          )}
                        </div>

                        <div className="flex-1">
                          <p className={`bp-text-body font-semibold ${tc.text}`}>
                            {sanitizeCustomerFacingText(txn.description)}
                          </p>
                          <p className={`bp-text-small ${tc.textSecondary}`}>
                            {new Date(txn.created_at).toLocaleTimeString(dateLocale, {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className={`bp-text-body font-bold ${
                            txDirection(txn) === 'credit' ? 'text-green-500' : 'text-red-500'
                          }`}>
                            {txDirection(txn) === 'credit' ? '+' : '-'}${txn.amount.toFixed(2)}
                          </p>
                          <p className={`bp-text-small ${
                            txn.status === 'completed' ? 'text-green-400' :
                            txn.status === 'pending' ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {getStatusLabel(txn.status)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
