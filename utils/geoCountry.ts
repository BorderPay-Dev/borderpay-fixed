const CACHE_KEY = 'borderpay_ip_country_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalize(value: unknown): string | null {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;
}

export async function loadIpCountry(): Promise<string | null> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - Number(cached.cachedAt || 0) < CACHE_TTL_MS) {
      return normalize(cached.country);
    }
  } catch {
    // A missing session cache must not widen receive-rail visibility.
  }

  try {
    const response = await fetch('/api/geo', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const country = normalize(payload?.country);
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ country, cachedAt: Date.now() }));
    } catch {
      // Cache failure is harmless.
    }
    return country;
  } catch {
    return null;
  }
}
