/**
 * NotificationsScreen — full-page notification inbox.
 *
 * Reads financial activity from the same transaction caches used by Dashboard,
 * Recent Activity, and Transactions, then merges non-financial notification
 * endpoint rows on top.
 *
 * AppShell owns the top chrome on top-level routes; this renders body-only.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '../../utils/errors/friendlyError';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, CheckCheck, Trash2, AlertCircle, Loader2, ChevronLeft,
  ArrowDownLeft, ArrowUpRight, ShieldCheck, Sparkles, Info,
} from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { sanitizeCustomerFacingText } from '../../utils/presentation/customerBranding';
import { SkeletonRows } from '../common/Skeleton';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { normalizeTransactionReceipt } from '../../utils/transactions/receipt';
import { txDirection } from '../../utils/transactions/direction';

interface NotificationRow {
  id:           string;
  user_id?:     string;
  title?:       string | null;
  body?:        string | null;
  message?:     string | null;        // legacy field
  type?:        string | null;        // 'transaction' | 'security' | 'kyc' | ...
  category?:    string | null;
  read?:        boolean;
  read_at?:     string | null;
  created_at:   string;
  metadata?:    Record<string, any>;
}

interface NotificationsScreenProps {
  onBack: () => void;
  onUnreadCountChange?: (count: number) => void;
}
const NOTIFICATION_FETCH_TIMEOUT_MS = 1400;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

const NOTIFICATIONS_CACHE_PREFIX = 'borderpay_notifications_cache:';
const TX_CACHE_KEY = 'borderpay_tx_history_v1';
const DASH_RECENT_TX_KEY = 'borderpay_dash_recent_tx_v1';
const BIZ_DASH_TX_KEY = 'borderpay_business_dash_tx_v1';

function readJSONRows(key: string | null): any[] {
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function currentNotificationCacheKey(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    return user?.id ? financialCacheKey(NOTIFICATIONS_CACHE_PREFIX, { userId: String(user.id) }) : null;
  } catch {
    return null;
  }
}

function currentUserId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    return user?.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

function readCachedNotifications(): NotificationRow[] {
  try {
    const key = currentNotificationCacheKey();
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

function writeCachedNotifications(rows: NotificationRow[]): void {
  try {
    const key = currentNotificationCacheKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({ rows: rows.slice(0, 50), cached_at: Date.now() }));
  } catch { /* ignore notification cache write */ }
}

function transactionTitle(tx: any): string {
  const raw = String(tx?.description || tx?.memo || tx?.type || tx?.transaction_type || 'Transaction').trim();
  return raw ? raw.replace(/_/g, ' ') : 'Transaction';
}

function transactionToNotification(tx: any): NotificationRow | null {
  const id = String(tx?.id || tx?.bridge_transfer_id || tx?.transfer_id || '').trim();
  if (!id) return null;
  const metadata = tx?.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
  const currency = String(tx?.currency || metadata?.currency || 'USD').toUpperCase();
  const receipt = tx?.receipt || normalizeTransactionReceipt({ amount: tx?.amount, metadata });
  const amount = Number(receipt?.finalAmount ?? tx?.amount ?? metadata?.amount ?? metadata?.net_amount ?? 0);
  const status = String(tx?.status || 'pending').toLowerCase();
  const direction = txDirection({
    ...tx,
    type: tx?.type || tx?.transaction_type,
    metadata,
  } as any);
  const createdAt = String(tx?.created_at || tx?.updated_at || new Date().toISOString());
  return {
    id: `tx:${id}`,
    title: transactionTitle(tx),
    body: `${direction === 'credit' ? 'Received' : 'Sent'} ${formatReceiptMoney(amount, currency)} · ${status}`,
    type: direction === 'credit' ? 'transaction_credit' : 'transaction_debit',
    category: 'transaction',
    read: true,
    created_at: createdAt,
    metadata: {
      ...metadata,
      amount,
      currency,
      direction,
      status,
      __activity_source: 'transactions',
      transaction_id: id,
    },
  };
}

function readCachedActivityNotifications(): NotificationRow[] {
  const uid = currentUserId();
  if (!uid) return [];
  const keys = [
    financialCacheKey(TX_CACHE_KEY, { userId: uid }),
    financialCacheKey(DASH_RECENT_TX_KEY, { userId: uid }),
    DASH_RECENT_TX_KEY,
    financialCacheKey(BIZ_DASH_TX_KEY, { userId: uid, accountType: 'business' }),
  ];
  const seen = new Set<string>();
  const rows: NotificationRow[] = [];
  keys.forEach((key) => {
    readJSONRows(key).forEach((tx) => {
      const row = transactionToNotification(tx);
      if (!row || seen.has(row.id)) return;
      seen.add(row.id);
      rows.push(row);
    });
  });
  return rows;
}

function composeNotificationRows(notificationRows: NotificationRow[], activityRows: NotificationRow[]): NotificationRow[] {
  const byId = new Map<string, NotificationRow>();
  activityRows.forEach((row) => byId.set(row.id, row));
  notificationRows.forEach((row) => {
    const id = String(row?.id || '').trim();
    if (!id) return;
    byId.set(id, row);
  });
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 100);
}

function unreadNotificationCount(rows: NotificationRow[]): number {
  return rows.filter((n) => !n.read && n.metadata?.__activity_source !== 'transactions').length;
}

function notifIcon(type?: string | null) {
  const t = (type || '').toLowerCase();
  if (t.includes('credit') || t.includes('deposit') || t.includes('received')) return ArrowDownLeft;
  if (t.includes('debit') || t.includes('send') || t.includes('transfer')) return ArrowUpRight;
  if (t.includes('kyc') || t.includes('verify') || t.includes('identity')) return ShieldCheck;
  if (t.includes('plan') || t.includes('subscription') || t.includes('upgrade')) return Sparkles;
  if (t.includes('security') || t.includes('login') || t.includes('pin') || t.includes('2fa')) return ShieldCheck;
  return Info;
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now  = Date.now();
    const sec  = Math.max(1, Math.floor((now - then) / 1000));
    if (sec < 60)  return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `${min}m ago`;
    const hr  = Math.floor(min / 60);
    if (hr  < 24)  return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7)   return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

function formatReceiptMoney(amount: number, currency: string): string {
  const c = String(currency || 'USD').toUpperCase();
  const formatted = Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: ['USDC', 'USDT'].includes(c) ? 6 : 2,
  });
  if (c === 'USD' || c === 'USDC') return `$${formatted}`;
  if (c === 'EUR') return `€${formatted}`;
  if (c === 'GBP') return `£${formatted}`;
  return `${formatted} ${c}`;
}

export function NotificationsScreen({ onBack, onUnreadCountChange }: NotificationsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const initialRows = useMemo(
    () => composeNotificationRows(readCachedNotifications(), readCachedActivityNotifications()),
    [],
  );
  const refreshTsKey = useMemo(() => {
    const uid = currentUserId() || 'anon';
    return financialCacheKey('borderpay_notifications_refresh_ts_v1', { userId: uid });
  }, []);
  const prewarmTsKey = useMemo(() => {
    const uid = currentUserId() || 'anon';
    return financialCacheKey('borderpay_notifications_prewarm_ts_v1', { userId: uid });
  }, []);
  const [rows, setRows]       = useState<NotificationRow[]>(initialRows);
  const rowsRef = useRef<NotificationRow[]>(initialRows);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const [loading, setLoading] = useState(initialRows.length === 0);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    if (loadInFlightRef.current) {
      await loadInFlightRef.current;
      return;
    }
    const run = (async () => {
    // Keep first paint instant; refresh in background and throttle fast re-entry.
    setError(null);
    try {
      const cachedActivityRows = readCachedActivityNotifications();
      if (cachedActivityRows.length > 0) {
        const merged = composeNotificationRows(
          rowsRef.current.filter((n) => n.metadata?.__activity_source !== 'transactions'),
          cachedActivityRows,
        );
        rowsRef.current = merged;
        setRows(merged);
      }
      const hasCachedRows = rowsRef.current.length > 0;
      if (!hasCachedRows) setLoading(true);
      const last = Number(localStorage.getItem(refreshTsKey) || '0');
      if (!force && hasCachedRows && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const uid = currentUserId();
      if (!uid) {
        setRows([]);
        writeCachedNotifications([]);
        onUnreadCountChange?.(0);
        return;
      }
      const [notifResult, txResult] = await Promise.all([
        withTimeout(
          backendAPI.notifications.getNotifications(50),
          NOTIFICATION_FETCH_TIMEOUT_MS,
          { success: false, error: 'notifications_timeout', data: { notifications: hasCachedRows ? rowsRef.current.filter((n) => n.metadata?.__activity_source !== 'transactions') : [] } } as any,
        ),
        withTimeout(
          backendAPI.transactions.getTransactions(100, 0),
          NOTIFICATION_FETCH_TIMEOUT_MS,
          { success: false, error: 'transactions_timeout', data: { transactions: [] } } as any,
        ),
      ]);
      const r: any = notifResult;
      let activityRows = readCachedActivityNotifications();
      if ((txResult as any)?.success) {
        const txRows = Array.isArray((txResult as any)?.data?.transactions)
          ? (txResult as any).data.transactions
          : [];
        try {
          localStorage.setItem(financialCacheKey(TX_CACHE_KEY, { userId: uid }), JSON.stringify(txRows));
        } catch { /* noop */ }
        activityRows = txRows
          .map(transactionToNotification)
          .filter((row: NotificationRow | null): row is NotificationRow => !!row);
      }
      if (r?.success || activityRows.length > 0) {
        const notificationRows = r?.success
          ? (Array.isArray((r as any)?.data?.notifications)
            ? (r as any).data.notifications
            : (Array.isArray((r as any)?.data) ? (r as any).data : []))
          : rowsRef.current.filter((n) => n.metadata?.__activity_source !== 'transactions');
        const data = composeNotificationRows(notificationRows, activityRows);
        rowsRef.current = data;
        setRows(data);
        writeCachedNotifications(notificationRows);
        try { localStorage.setItem(refreshTsKey, String(Date.now())); } catch { /* noop */ }
        onUnreadCountChange?.(unreadNotificationCount(data));
      } else if (!hasCachedRows) {
        setError(
          friendlyError(
            r?.error || 'notifications_unavailable',
            "Notifications couldn't be loaded right now."
          ),
        );
      }
    } catch (e: any) {
      if (rowsRef.current.length === 0) {
        setError(friendlyError(e, "Notifications couldn't be loaded right now."));
      }
    } finally {
      setLoading(false);
    }
    })();
    loadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (loadInFlightRef.current === run) {
        loadInFlightRef.current = null;
      }
    }
  }, [onUnreadCountChange, refreshTsKey]);

  useEffect(() => {
    load();
    try {
      const last = Number(localStorage.getItem(prewarmTsKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['transactions', 'settings', 'profile', 'dashboard'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 900 });
          else setTimeout(warm, 120);
        }
        localStorage.setItem(prewarmTsKey, String(Date.now()));
      }
    } catch { /* noop */ }
    const onFocus = () => { void load(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, prewarmTsKey]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const unreadCount = useMemo(() => unreadNotificationCount(rows), [rows]);

  const handleMarkRead = async (n: NotificationRow) => {
    if (n.read) return;
    if (n.metadata?.__activity_source === 'transactions') return;
    setBusyId(n.id);
    setRows(prev => {
      const next = prev.map(r => r.id === n.id ? { ...r, read: true } : r);
      writeCachedNotifications(next.filter((r) => r.metadata?.__activity_source !== 'transactions'));
      onUnreadCountChange?.(unreadNotificationCount(next));
      return next;
    });
    try {
      await backendAPI.notifications.markAsRead(n.id);
    } catch { /* keep optimistic */ }
    finally { setBusyId(null); }
  };

  const handleMarkAllRead = async () => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r, read: true }));
      writeCachedNotifications(next.filter((r) => r.metadata?.__activity_source !== 'transactions'));
      onUnreadCountChange?.(0);
      return next;
    });
    try { await backendAPI.notifications.markAllAsRead(); } catch { /* ignore */ }
  };

  const handleDelete = async (n: NotificationRow) => {
    if (n.metadata?.__activity_source === 'transactions') return;
    setBusyId(n.id);
    setRows(prev => {
      const next = prev.filter(r => r.id !== n.id);
      writeCachedNotifications(next.filter((r) => r.metadata?.__activity_source !== 'transactions'));
      onUnreadCountChange?.(unreadNotificationCount(next));
      return next;
    });
    try { await backendAPI.notifications.deleteNotification(n.id); } catch { /* ignore */ }
    finally { setBusyId(null); }
  };

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                aria-label="Back"
                className={`-ml-2 p-2 rounded-full ${tc.hoverBg} transition-colors`}
              >
                <ChevronLeft className={`w-5 h-5 ${tc.text}`} />
              </button>
            )}
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
              {tt('notifications.title', 'Notifications')}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#C7FF00] hover:underline"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className={`text-xs ${tc.text}`}>{error}</p>
              <button
                type="button"
                onClick={() => load(true)}
                className="mt-2 text-[11px] font-semibold text-[#C7FF00]"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {loading && rows.length > 0 ? (
          <div className={`mb-3 text-[11px] ${tc.textMuted}`}>Refreshing notifications…</div>
        ) : null}

        {rows.length === 0 ? (
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} px-6 py-12 text-center`}>
            <div className={`w-14 h-14 rounded-2xl ${tc.bgAlt} flex items-center justify-center mx-auto mb-4`}>
              <Bell className={`w-6 h-6 ${tc.textMuted}`} />
            </div>
            <p className={`text-sm font-semibold ${tc.text} mb-1`}>You're all caught up</p>
            <p className={`text-xs ${tc.textMuted}`}>
              Transaction updates, security alerts, and account updates will appear here.
            </p>
          </div>
        ) : (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
            <AnimatePresence initial={false}>
              {rows.map((n, i) => {
                const Icon = notifIcon(n.type);
                const message = sanitizeCustomerFacingText((n.body || n.message || '').toString());
                const title = sanitizeCustomerFacingText(
                  n.title || (n.type ? n.type.replace(/_/g, ' ') : 'Notification')
                );
                const receipt = normalizeTransactionReceipt({
                  amount: n.metadata?.amount ?? n.metadata?.net_amount,
                  metadata: n.metadata,
                });
                const direction = String(n.metadata?.direction || '').toLowerCase();
                const isCredit = direction === 'credit' || /received|deposit|credit/i.test(title);
                const currency = String(n.metadata?.currency || 'USD').toUpperCase();
                const isActivityRow = n.metadata?.__activity_source === 'transactions';
                return (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`px-4 py-3.5 flex items-start gap-3 cursor-pointer ${tc.hoverBg} ${i > 0 ? `border-t ${tc.borderLight}` : ''} ${!n.read ? 'bg-white/[0.02]' : ''}`}
                    onClick={() => handleMarkRead(n)}
                  >
                    <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${tc.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm font-semibold ${tc.text} truncate`}>
                          {title}
                        </p>
                        {!n.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF00] flex-shrink-0" aria-label="Unread" />
                        )}
                      </div>
                      {message && (
                        <p className={`text-[12px] ${tc.textSecondary} leading-snug line-clamp-2`}>
                          {message}
                        </p>
                      )}
                      {receipt?.hasFees && (
                        <div className={`mt-2 grid grid-cols-2 gap-y-1 text-[11px] ${tc.textMuted}`}>
                          <span>{isCredit ? 'Received' : 'Sent'}</span>
                          <span className="text-right font-mono">{formatReceiptMoney(receipt.initialAmount, currency)}</span>
                          {receipt.developerFeeAmount > 0 && (
                            <>
                              <span>Service fee</span>
                              <span className="text-right font-mono">-{formatReceiptMoney(receipt.developerFeeAmount, currency)}</span>
                            </>
                          )}
                          {receipt.exchangeFeeAmount > 0 && (
                            <>
                              <span>Exchange fee</span>
                              <span className="text-right font-mono">-{formatReceiptMoney(receipt.exchangeFeeAmount, currency)}</span>
                            </>
                          )}
                          <span className={`font-semibold ${tc.text}`}>{isCredit ? 'You receive' : 'Net delivered'}</span>
                          <span className={`text-right font-mono font-semibold ${tc.text}`}>{formatReceiptMoney(receipt.finalAmount, currency)}</span>
                        </div>
                      )}
                      <p className={`text-[10px] ${tc.textMuted} mt-1`}>{relativeTime(n.created_at)}</p>
                    </div>
                    {!isActivityRow && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(n); }}
                        disabled={busyId === n.id}
                        aria-label="Delete notification"
                        className={`p-1.5 rounded-full ${tc.hoverBg} text-red-400 flex-shrink-0`}
                      >
                        {busyId === n.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <button
          onClick={onBack}
          className={`mt-6 text-[11px] font-semibold ${tc.textMuted} hover:${tc.text}`}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default NotificationsScreen;
