import { backendAPI } from './api/backendAPI';

type CapabilityAction = 'routing' | 'rates';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const memory = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any>>();
// Bump when response eligibility rules change so a stale empty sandbox route
// cannot survive a corrected deployment in sessionStorage.
const CACHE_PREFIX = 'borderpay_yellowcard_capability_v2:';

function stablePayload(payload: Record<string, unknown>) {
  return Object.keys(payload)
    .sort()
    .reduce<Record<string, unknown>>((next, key) => {
      const value = payload[key];
      if (value !== undefined && value !== null && value !== '') next[key] = value;
      return next;
    }, {});
}

function cacheKey(action: CapabilityAction, payload: Record<string, unknown>) {
  return `${CACHE_PREFIX}${action}:${JSON.stringify(stablePayload(payload))}`;
}

function readCache(key: string): any | null {
  const now = Date.now();
  const local = memory.get(key);
  if (local && local.expiresAt > now) return local.value;
  if (local) memory.delete(key);
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || 'null') as CacheEntry | null;
    if (parsed && parsed.expiresAt > now && parsed.value) {
      memory.set(key, parsed);
      return parsed.value;
    }
    sessionStorage.removeItem(key);
  } catch { /* cache is best-effort */ }
  return null;
}

function writeCache(key: string, value: unknown, ttlMs: number) {
  const entry = { expiresAt: Date.now() + ttlMs, value };
  memory.set(key, entry);
  try { sessionStorage.setItem(key, JSON.stringify(entry)); } catch { /* cache is best-effort */ }
}

function hasUsableCapability(action: CapabilityAction, result: any): boolean {
  if (!result?.success) return false;
  if (action === 'routing') {
    const routing = result?.data?.routing;
    const networks = Array.isArray(routing?.networks) ? routing.networks : [];
    return Boolean(routing?.available) && networks.length > 0;
  }
  return Boolean(result?.data);
}

/**
 * Cache read-only Yellow Card sandbox discovery. Transaction preflight/create
 * responses are intentionally excluded so execution and idempotency stay live.
 */
export async function loadYellowCardCapability(
  action: CapabilityAction,
  payload: Record<string, unknown>,
): Promise<any> {
  const key = cacheKey(action, payload);
  const cached = readCache(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = backendAPI.payouts.yellowCardCapabilities(action, payload)
    .then((result: any) => {
      if (hasUsableCapability(action, result)) {
        writeCache(key, result, action === 'routing' ? 5 * 60_000 : 30_000);
      }
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export const YELLOW_CARD_PAYMENT_REASONS = [
  { value: 'gift', label: 'Gift' },
  { value: 'bills', label: 'Bills' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'travel', label: 'Travel' },
  { value: 'health', label: 'Health' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'housing', label: 'Housing' },
  { value: 'school-fees', label: 'School fees' },
  { value: 'other', label: 'Other' },
] as const;
