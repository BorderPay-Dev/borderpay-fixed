export type AfricanRailDisplay = {
  countryCode: string;
  currency: string;
  country: string;
  flag: string;
  symbol: string;
  usdRate: number;
};

const AFRICAN_RAIL_DISPLAY: Record<string, AfricanRailDisplay> = {
  BJ: { countryCode: 'BJ', country: 'Benin', currency: 'XOF', flag: '🇧🇯', symbol: 'CFA', usdRate: 610 },
  BW: { countryCode: 'BW', country: 'Botswana', currency: 'BWP', flag: '🇧🇼', symbol: 'P', usdRate: 13.6 },
  BF: { countryCode: 'BF', country: 'Burkina Faso', currency: 'XOF', flag: '🇧🇫', symbol: 'CFA', usdRate: 610 },
  CM: { countryCode: 'CM', country: 'Cameroon', currency: 'XAF', flag: '🇨🇲', symbol: 'FCFA', usdRate: 610 },
  CF: { countryCode: 'CF', country: 'Central Africa Republic', currency: 'XAF', flag: '🇨🇫', symbol: 'FCFA', usdRate: 610 },
  TD: { countryCode: 'TD', country: 'Chad', currency: 'XAF', flag: '🇹🇩', symbol: 'FCFA', usdRate: 610 },
  CG: { countryCode: 'CG', country: 'Congo Brazzaville', currency: 'XAF', flag: '🇨🇬', symbol: 'FCFA', usdRate: 610 },
  EG: { countryCode: 'EG', country: 'Egypt', currency: 'EGP', flag: '🇪🇬', symbol: 'E£', usdRate: 48.5 },
  GA: { countryCode: 'GA', country: 'Gabon', currency: 'XAF', flag: '🇬🇦', symbol: 'FCFA', usdRate: 610 },
  GH: { countryCode: 'GH', country: 'Ghana', currency: 'GHS', flag: '🇬🇭', symbol: '₵', usdRate: 15.5 },
  CI: { countryCode: 'CI', country: 'Ivory Coast', currency: 'XOF', flag: '🇨🇮', symbol: 'CFA', usdRate: 610 },
  KE: { countryCode: 'KE', country: 'Kenya', currency: 'KES', flag: '🇰🇪', symbol: 'KSh', usdRate: 135 },
  MW: { countryCode: 'MW', country: 'Malawi', currency: 'MWK', flag: '🇲🇼', symbol: 'MK', usdRate: 1730 },
  ML: { countryCode: 'ML', country: 'Mali', currency: 'XOF', flag: '🇲🇱', symbol: 'CFA', usdRate: 610 },
  NG: { countryCode: 'NG', country: 'Nigeria', currency: 'NGN', flag: '🇳🇬', symbol: '₦', usdRate: 1500 },
  RW: { countryCode: 'RW', country: 'Rwanda', currency: 'RWF', flag: '🇷🇼', symbol: 'FRw', usdRate: 1450 },
  SN: { countryCode: 'SN', country: 'Senegal', currency: 'XOF', flag: '🇸🇳', symbol: 'CFA', usdRate: 610 },
  ZA: { countryCode: 'ZA', country: 'South Africa', currency: 'ZAR', flag: '🇿🇦', symbol: 'R', usdRate: 18.2 },
  TZ: { countryCode: 'TZ', country: 'Tanzania', currency: 'TZS', flag: '🇹🇿', symbol: 'TSh', usdRate: 2600 },
  TG: { countryCode: 'TG', country: 'Togo', currency: 'XOF', flag: '🇹🇬', symbol: 'CFA', usdRate: 610 },
  UG: { countryCode: 'UG', country: 'Uganda', currency: 'UGX', flag: '🇺🇬', symbol: 'USh', usdRate: 3700 },
  ZM: { countryCode: 'ZM', country: 'Zambia', currency: 'ZMW', flag: '🇿🇲', symbol: 'ZK', usdRate: 26.5 },
};

export function localRailForCountry(country?: string | null): AfricanRailDisplay | null {
  const code = String(country || '').trim().toUpperCase();
  if (!code || code === 'CD' || code === 'DRC') return null;
  return AFRICAN_RAIL_DISPLAY[code] || null;
}

export function localRailForStoredUser(): AfricanRailDisplay | null {
  try {
    const raw = localStorage.getItem('borderpay_user');
    const stored = raw ? JSON.parse(raw) : null;
    const country = stored?.country || stored?.user_metadata?.country || stored?.profile?.country;
    return localRailForCountry(country);
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
