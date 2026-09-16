/** Local review pacing. This is not evidence that the store displayed a review or that one was submitted. */
export const REVIEW_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
const ATTEMPT_KEY = 'borderpay_review_attempt_v1';
const visitKey = (userId: string) => `borderpay_review_days_v1:${userId}`;
type ReviewStorage = Pick<Storage, 'getItem' | 'setItem'>;

function readDays(storage: ReviewStorage, userId: string, today: string): string[] {
  const parsed: unknown = JSON.parse(storage.getItem(visitKey(userId)) || '[]');
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((v): v is string =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today,
  ))].sort().slice(-3);
}

export function recordReviewVisit(storage: ReviewStorage, userId: string, now = Date.now()): void {
  if (!userId) return;
  try {
    const today = new Date(now).toISOString().slice(0, 10);
    const days = [...new Set([...readDays(storage, userId, today), today])].sort().slice(-3);
    storage.setItem(visitKey(userId), JSON.stringify(days));
  } catch { /* Unavailable storage must never interrupt the app. */ }
}

export function claimReviewAttempt(storage: ReviewStorage, userId: string, eligible: boolean, now = Date.now()): boolean {
  if (!userId || !eligible) return false;
  try {
    const today = new Date(now).toISOString().slice(0, 10);
    if (readDays(storage, userId, today).length < 3) return false;
    const previous = storage.getItem(ATTEMPT_KEY);
    if (previous !== null) {
      const last = Number(previous);
      if (!Number.isFinite(last) || now - last < REVIEW_INTERVAL_MS) return false;
    }
    // Persist before calling the OS: double taps, suppressed dialogs and plugin
    // failures must not cause repeated requests. Shared across accounts on device.
    storage.setItem(ATTEMPT_KEY, String(now));
    return true;
  } catch { return false; }
}
