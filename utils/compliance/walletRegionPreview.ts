import { ISO2_COUNTRIES, ISO3_TO_ISO2 } from '../../supabase/functions/_shared/iso-country-codes.ts';

// Informational catalogue only. Never use this to authorize a wallet or payout.
export const PREVIEW_EEA_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE',
  'IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE',
]);
export function previewWalletAssets(country: unknown): string[] {
  const raw = String(country ?? '').trim().toUpperCase();
  const code = ISO3_TO_ISO2[raw] || raw;
  if (!ISO2_COUNTRIES.has(code)) return [];
  return PREVIEW_EEA_COUNTRIES.has(code) ? ['USDC', 'EURC'] : ['USDC', 'USDT'];
}
