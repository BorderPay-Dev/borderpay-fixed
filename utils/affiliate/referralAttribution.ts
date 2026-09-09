export const REFERRAL_CODE_STORAGE_KEY = 'borderpay_referral_code';

const REFERRAL_CODE_PATTERN = /^BP[0-9A-F]{6}$/;

export function normalizeReferralCode(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function extractReferralCodeFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, 'https://app.borderpayafrica.com');
    const queryCode = url.searchParams.get('ref') || url.searchParams.get('referral_code');
    const normalizedQueryCode = normalizeReferralCode(queryCode);
    if (normalizedQueryCode) return normalizedQueryCode;

    const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(rawHash);
    return normalizeReferralCode(hashParams.get('ref') || hashParams.get('referral_code'));
  } catch {
    return null;
  }
}

export function captureReferralAttributionFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const code = extractReferralCodeFromUrl(window.location.href);
  if (!code) return null;
  try {
    window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
  } catch {
    return null;
  }
  return code;
}

export function readStoredReferralCode(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return normalizeReferralCode(window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)) || undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private/embedded browser contexts.
  }
}
