import { financialCacheKey } from './cacheScope';

export const TRANSACTION_HISTORY_CACHE_BASE = 'borderpay_tx_history_v1';
export const TRANSACTION_REFRESH_TS_CACHE_BASE = 'borderpay_tx_refresh_ts_v1';
export const NOTIFICATION_INBOX_CACHE_BASE = 'borderpay_notifications_cache_v1';
export const NOTIFICATION_REFRESH_TS_CACHE_BASE = 'borderpay_notifications_refresh_ts_v1';
export const LEGACY_DASHBOARD_RECENT_TX_CACHE_BASE = 'borderpay_dash_recent_tx_v1';
export const LEGACY_BUSINESS_DASHBOARD_TX_CACHE_BASE = 'borderpay_business_dash_tx_v1';
export const LEGACY_NOTIFICATION_CACHE_PREFIX = 'borderpay_notifications_cache:';

export function transactionHistoryCacheKey(userId?: string | null): string {
  return financialCacheKey(TRANSACTION_HISTORY_CACHE_BASE, { userId });
}

export function transactionRefreshTsCacheKey(userId?: string | null): string {
  return financialCacheKey(TRANSACTION_REFRESH_TS_CACHE_BASE, { userId });
}

export function legacyDashboardRecentTxCacheKey(userId?: string | null): string {
  return financialCacheKey(LEGACY_DASHBOARD_RECENT_TX_CACHE_BASE, { userId });
}

export function legacyBusinessDashboardTxCacheKey(userId?: string | null): string {
  return financialCacheKey(LEGACY_BUSINESS_DASHBOARD_TX_CACHE_BASE, { userId });
}

export function notificationInboxCacheKey(userId?: string | null): string {
  return financialCacheKey(NOTIFICATION_INBOX_CACHE_BASE, { userId });
}

export function notificationRefreshTsCacheKey(userId?: string | null): string {
  return financialCacheKey(NOTIFICATION_REFRESH_TS_CACHE_BASE, { userId });
}

export function legacyNotificationInboxCacheKey(userId?: string | null): string {
  const id = String(userId || '').trim() || 'anon';
  return `${LEGACY_NOTIFICATION_CACHE_PREFIX}${id}`;
}

export function readCacheJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeCacheJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable in private browsing or quota pressure.
  }
}
