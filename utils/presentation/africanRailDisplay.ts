import { AFRICA_COMMERCIAL_FEE_ROUTES, africaIso2FromCountryCode } from '../fees/africaCommercialPricing';
import { ALL_COUNTRIES } from '../countries/allCountries';

export type AfricanRailDisplay = {
  /** Bridge/local-rail country code. Use ISO-3 here, e.g. KEN, NGA, GHA. */
  countryCode: string;
  /** ISO-2 is only for flag rendering and legacy browser profile values. */
  countryIso2: string;
  countryIso3: string;
  currency: string;
  country: string;
  flag: string;
  symbol: string;
  usdRate: number;
};

const CURRENCY_DISPLAY: Record<string, { symbol: string; usdRate: number }> = {
  BWP: { symbol: 'P', usdRate: 13.6 },
  CDF: { symbol: 'FC', usdRate: 2850 },
  EGP: { symbol: 'E£', usdRate: 48.5 },
  GHS: { symbol: '₵', usdRate: 15.5 },
  KES: { symbol: 'KSh', usdRate: 135 },
  MWK: { symbol: 'MK', usdRate: 1730 },
  NGN: { symbol: '₦', usdRate: 1500 },
  RWF: { symbol: 'FRw', usdRate: 1450 },
  TZS: { symbol: 'TSh', usdRate: 2600 },
  UGX: { symbol: 'USh', usdRate: 3700 },
  USD: { symbol: '$', usdRate: 1 },
  XAF: { symbol: 'FCFA', usdRate: 610 },
  XOF: { symbol: 'CFA', usdRate: 610 },
  ZAR: { symbol: 'R', usdRate: 18.2 },
  ZMW: { symbol: 'ZK', usdRate: 26.5 },
};

export function currencySymbolForCode(currency: string): string {
  const code = String(currency || '').trim().toUpperCase();
  return CURRENCY_DISPLAY[code]?.symbol || code;
}

export function currencyLabelForCode(currency: string): string {
  const code = String(currency || '').trim().toUpperCase();
  const symbol = currencySymbolForCode(code);
  return symbol === code ? code : `${symbol} ${code}`;
}

function normalizeCountryInput(value?: string | null): string {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isoFlag(code: string): string {
  const iso = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return '';
  return iso
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

export function flagForCountryCode(code: string): string {
  const iso = africaIso2FromCountryCode(code);
  return ALL_COUNTRIES.find((country) => country.code === iso)?.flag || isoFlag(iso);
}

function codeFromCountryInput(country?: string | null): string | null {
  const raw = String(country || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'DRC') return 'CD';
  if (/^[A-Z]{2,3}$/.test(upper)) return africaIso2FromCountryCode(upper);

  const normalized = normalizeCountryInput(raw);
  const onboardingCountry = ALL_COUNTRIES.find((item) => normalizeCountryInput(item.name) === normalized);
  if (onboardingCountry) return onboardingCountry.code;

  const routeCountry = AFRICA_COMMERCIAL_FEE_ROUTES.find((route) =>
    normalizeCountryInput(route.country) === normalized,
  );
  return routeCountry?.iso2 || null;
}

function firstActiveCommercialRouteForCountry(code: string) {
  const iso = String(code || '').toUpperCase();
  return AFRICA_COMMERCIAL_FEE_ROUTES.find((route) => route.enabled && route.iso2 === iso) || null;
}

export function localRailForCountry(country?: string | null): AfricanRailDisplay | null {
  const code = codeFromCountryInput(country);
  if (!code) return null;
  const route = firstActiveCommercialRouteForCountry(code);
  if (!route) return null;
  const currency = String(route.currency || '').toUpperCase();
  const display = CURRENCY_DISPLAY[currency] || { symbol: currency, usdRate: 1 };
  return {
    countryCode: route.iso3,
    countryIso2: route.iso2,
    countryIso3: route.iso3,
    country: route.country,
    currency,
    flag: flagForCountryCode(route.iso2),
    symbol: display.symbol,
    usdRate: display.usdRate,
  };
}

function countryCodeFromCandidate(candidate: any): string | null {
  if (!candidate) return null;
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate !== 'object') return null;
  const nested = [
    candidate.code,
    candidate.iso2,
    candidate.country_code,
    candidate.countryCode,
    candidate.name,
    candidate.country,
  ];
  for (const value of nested) {
    const raw = String(value || '').trim();
    if (raw) return raw;
  }
  return null;
}

function firstCountryCodeFrom(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  const candidates = [
    value.country,
    value.country_code,
    value.countryCode,
    value.country_name,
    value.countryName,
    value.nationality,
    value.country_of_residence,
    value.residence_country,
    value.selectedCountry,
    value.address?.country,
    value.address?.country_code,
    value.address?.countryCode,
    value.address?.country_name,
    value.profile?.country,
    value.profile?.country_code,
    value.profile?.countryCode,
    value.profile?.country_name,
    value.profile?.nationality,
    value.profile?.country_of_residence,
    value.profile?.residence_country,
    value.profile?.selectedCountry,
    value.kyc?.country,
    value.kyc?.country_code,
    value.kyc?.countryCode,
    value.kyc?.country_name,
    value.individual?.country,
    value.individual?.country_code,
    value.individual?.countryCode,
    value.business?.country,
    value.business?.country_code,
    value.business?.countryCode,
    value.user_metadata?.country,
    value.user_metadata?.country_code,
    value.user_metadata?.countryCode,
    value.user_metadata?.country_name,
    value.user_metadata?.selectedCountry,
    value.app_metadata?.country,
    value.app_metadata?.country_code,
    value.app_metadata?.countryCode,
    value.app_metadata?.country_name,
  ];
  for (const candidate of candidates) {
    const code = countryCodeFromCandidate(candidate);
    if (code) return code;
  }
  return null;
}

export function localRailForStoredUser(): AfricanRailDisplay | null {
  try {
    const keys = [
      'borderpay_user',
      'borderpay_cached_profile',
      'borderpay_profile',
      'borderpay_identity',
    ];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const stored = JSON.parse(raw);
      const rail = localRailForCountry(firstCountryCodeFrom(stored));
      if (rail) return rail;
    }
    return null;
  } catch {
    return null;
  }
}

export function shouldDisplayUsdtAsLocalRail(country?: string | null): boolean {
  return !!localRailForCountry(country);
}

export function formatLocalRailAmount(amountUsd: number, rail: AfricanRailDisplay): string {
  const value = Number(amountUsd || 0) * rail.usdRate;
  const maximumFractionDigits = ['XOF', 'XAF', 'RWF', 'TZS', 'UGX', 'MWK', 'NGN', 'KES'].includes(rail.currency) ? 0 : 2;
  return `${rail.symbol} ${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })}`;
}
