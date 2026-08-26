import { backendAPI } from './api/backendAPI';

export type AfricanRailDirection = 'payout' | 'receive';
export type AfricanRailChannel = 'bank' | 'mobile_money';

export type AfricanPolicyRow = {
  countryCode: string;
  currency: string;
  channel: AfricanRailChannel;
  provider: string;
  priority: number;
  raw: Record<string, unknown>;
};

// Bump whenever the authoritative corridor source changes so clients cannot
// keep rendering a stale pre-production/static catalogue after a cutover.
const CACHE_VERSION = 'v4-production-api';
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15000;

const memoryCache = new Map<string, { rows: AfricanPolicyRow[]; cachedAt: number }>();
const inFlight = new Map<string, Promise<AfricanPolicyRow[]>>();

function policyScope(direction: AfricanRailDirection): string {
  try {
    const user = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    const userId = String(user?.id || 'anonymous').trim() || 'anonymous';
    const country = direction === 'receive' ? String(user?.country || 'none').trim().toUpperCase() : 'global';
    return `${direction}:${userId}:${country}`;
  } catch {
    return `${direction}:anonymous:${direction === 'receive' ? 'none' : 'global'}`;
  }
}

function cacheKey(direction: AfricanRailDirection) {
  return `borderpay_african_rail_policy_${CACHE_VERSION}:${policyScope(direction)}`;
}

function normalizeAfricanPolicyRows(rows: Array<Record<string, unknown>>): AfricanPolicyRow[] {
  const seen = new Set<string>();
  const normalized: AfricanPolicyRow[] = [];
  rows.forEach((row) => {
    const countryCode = String(row.country_code || row.country || row.destination_country || '').trim().toUpperCase();
    const currency = String(row.destination_currency || row.currency || '').trim().toUpperCase();
    const rawChannel = String(row.channel || '').trim().toLowerCase();
    const provider = String(row.provider || 'backend_policy').trim().toLowerCase();
    if (provider !== 'yellow_card') return;
    if (!countryCode || !currency) return;
    if (rawChannel !== 'bank' && rawChannel !== 'mobile_money') return;
    if (row.enabled === false) return;
    const channel = rawChannel as AfricanRailChannel;
    const key = `${provider}:${countryCode}:${currency}:${channel}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      countryCode,
      currency,
      channel,
      provider,
      priority: Number(row.priority || 0),
      raw: row,
    });
  });
  return normalized.sort((a, b) => b.priority - a.priority || a.countryCode.localeCompare(b.countryCode));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function readCachedAfricanPolicyRows(direction: AfricanRailDirection): AfricanPolicyRow[] {
  const scope = policyScope(direction);
  const memory = memoryCache.get(scope);
  if (memory?.rows.length) return memory.rows;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(direction)) || 'null');
    const rows = Array.isArray(cached?.rows) ? cached.rows : [];
    if (!rows.length) return [];
    const cachedAt = Number(cached?.cachedAt || 0);
    memoryCache.set(scope, { rows, cachedAt });
    return rows;
  } catch {
    return [];
  }
}

export function hasFreshAfricanPolicyRows(direction: AfricanRailDirection): boolean {
  const memory = memoryCache.get(policyScope(direction));
  if (memory?.rows.length && Date.now() - memory.cachedAt < CACHE_TTL_MS) return true;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(direction)) || 'null');
    return Array.isArray(cached?.rows) && cached.rows.length > 0 && Date.now() - Number(cached.cachedAt || 0) < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

export async function loadAfricanPolicyRows(
  direction: AfricanRailDirection,
  options: { force?: boolean; timeoutMs?: number } = {},
): Promise<AfricanPolicyRow[]> {
  const cachedRows = readCachedAfricanPolicyRows(direction);
  const scope = policyScope(direction);
  if (!options.force && cachedRows.length && hasFreshAfricanPolicyRows(direction)) return cachedRows;

  const existing = inFlight.get(scope);
  if (existing && !options.force) return existing;

  const request = (async () => {
    const label = direction === 'receive' ? 'receive' : 'payout';
    const res: any = await withTimeout(
      backendAPI.payouts.yellowCardCapabilities('corridor_policy', { direction }),
      options.timeoutMs || DEFAULT_TIMEOUT_MS,
      `African ${label} rails are taking too long to load. Please retry.`,
    );
    if (!res?.success) throw new Error(res?.error || `Unable to load African ${label} rails.`);
    const sourceRows = Array.isArray(res?.data?.local_rail_policy?.rows)
      ? res.data.local_rail_policy.rows
      : [];
    const normalized = normalizeAfricanPolicyRows(sourceRows);
    if (normalized.length === 0 && direction !== 'receive') {
      throw new Error(`No African ${label} rails are available right now.`);
    }
    const cachedAt = Date.now();
    memoryCache.set(scope, { rows: normalized, cachedAt });
    try {
      localStorage.setItem(cacheKey(direction), JSON.stringify({ cachedAt, rows: normalized }));
    } catch {
      // Cache write failure should not block the live flow.
    }
    return normalized;
  })();

  inFlight.set(scope, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(scope) === request) inFlight.delete(scope);
  }
}
