export type PartnerBranding = {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
};

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('.') || host === 'localhost' || /^[\d.:]+$/.test(host)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizePartnerBranding(value: unknown): PartnerBranding | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (raw.branding_enabled !== true) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 80) return null;
  const primary = typeof raw.primary_color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.primary_color.trim())
    ? raw.primary_color.trim().toUpperCase()
    : null;
  return {
    name,
    logoUrl: safeHttpsUrl(raw.logo_url),
    primaryColor: primary,
  };
}

export function extractAndScrubOnboardingToken(href: string): {
  token: string;
  sanitizedPath: string;
} {
  const url = new URL(href);
  const hashBody = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hashParams = hashBody.includes('=') ? new URLSearchParams(hashBody) : null;
  const fragmentToken = hashParams?.get('onboarding_token')?.trim() || '';
  const legacyQueryToken = url.searchParams.get('onboarding_token')?.trim() || '';
  const token = fragmentToken || legacyQueryToken;

  url.searchParams.delete('onboarding_token');
  if (hashParams?.has('onboarding_token')) {
    hashParams.delete('onboarding_token');
    const remaining = hashParams.toString();
    url.hash = remaining ? `#${remaining}` : '';
  }

  return {
    token: token.length <= 8192 ? token : '',
    sanitizedPath: `${url.pathname}${url.search}${url.hash}`,
  };
}
