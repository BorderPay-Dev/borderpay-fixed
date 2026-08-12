import { backendAPI } from './api/backendAPI';

type CapabilityAction = 'routing' | 'quote';

type CacheEntry = {
  expiresAt: number;
  staleUntil: number;
  value: unknown;
};

const memory = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any>>();
// Bump when response eligibility rules change so a stale empty sandbox route
// cannot survive a corrected deployment in localStorage.
const CACHE_PREFIX = 'borderpay_yellowcard_capability_v4:';

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
  if (local && local.staleUntil <= now) memory.delete(key);
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null') as CacheEntry | null;
    if (parsed && parsed.expiresAt > now && parsed.value) {
      memory.set(key, parsed);
      return parsed.value;
    }
    // Preserve an expired-but-validated entry for readStaleCache. It is only
    // used when Yellow Card cannot refresh the capability successfully.
    if (!parsed || parsed.staleUntil <= now) localStorage.removeItem(key);
  } catch { /* cache is best-effort */ }
  return null;
}

function readStaleCache(key: string): any | null {
  const now = Date.now();
  const local = memory.get(key);
  if (local && local.staleUntil > now) return local.value;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null') as CacheEntry | null;
    if (parsed && parsed.staleUntil > now && parsed.value) return parsed.value;
  } catch { /* cache is best-effort */ }
  return null;
}

function deleteCache(key: string) {
  memory.delete(key);
  try { localStorage.removeItem(key); } catch { /* cache is best-effort */ }
}

function writeCache(key: string, value: unknown, ttlMs: number) {
  const entry = { expiresAt: Date.now() + ttlMs, staleUntil: Date.now() + (ttlMs === 5 * 60_000 ? 24 * 60 * 60_000 : 15 * 60_000), value };
  memory.set(key, entry);
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* cache is best-effort */ }
}

function hasUsableCapability(action: CapabilityAction, result: any): boolean {
  if (!result?.success) return false;
  if (action === 'routing') {
    const routing = result?.data?.routing;
    const networks = Array.isArray(routing?.networks) ? routing.networks : [];
    return Boolean(routing?.available) && networks.length > 0;
  }
  return Boolean(result?.data?.quote?.rate);
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
  if (cached && hasUsableCapability(action, cached)) return cached;
  if (cached) deleteCache(key);
  const staleCandidate = readStaleCache(key);
  const lastValidated = staleCandidate && hasUsableCapability(action, staleCandidate)
    ? staleCandidate
    : null;
  if (staleCandidate && !lastValidated) deleteCache(key);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const fetchWithRetry = async () => {
    let result: any = null;
    const attempts = action === 'routing' ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      result = await backendAPI.payouts.yellowCardCapabilities(action, payload);
      if (result?.success) return result;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    return result;
  };
  const request = fetchWithRetry()
    .then((result: any) => {
      if (hasUsableCapability(action, result)) {
        writeCache(key, result, action === 'routing' ? 5 * 60_000 : 60_000);
      }
      return result?.success ? result : (lastValidated || result);
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
