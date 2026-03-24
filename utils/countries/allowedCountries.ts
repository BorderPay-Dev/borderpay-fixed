/**
 * BorderPay Africa - Allowed Countries
 * All African countries except restricted jurisdictions + USA, Canada, UK, France
 */

import type { Country } from './allCountries';
import { RESTRICTED_JURISDICTIONS } from '../compliance/restrictedJurisdictions';

const restrictedCodes = new Set(RESTRICTED_JURISDICTIONS.map(c => c.code));

/**
 * Explicitly allowed countries:
 * - All African countries NOT on the restricted list
 * - Global: USA, Canada, United Kingdom, France
 */
export const ALLOWED_COUNTRIES: Country[] = [
  // ── African Countries (unrestricted) ──────────────────────────────────────
  { code: 'DZ', name: 'Algeria',                  dialCode: '+213', flag: '🇩🇿' },
  { code: 'BJ', name: 'Benin',                    dialCode: '+229', flag: '🇧🇯' },
  { code: 'BW', name: 'Botswana',                 dialCode: '+267', flag: '🇧🇼' },
  { code: 'BF', name: 'Burkina Faso',             dialCode: '+226', flag: '🇧🇫' },
  { code: 'CM', name: 'Cameroon',                 dialCode: '+237', flag: '🇨🇲' },
  { code: 'CV', name: 'Cape Verde',               dialCode: '+238', flag: '🇨🇻' },
  { code: 'TD', name: 'Chad',                     dialCode: '+235', flag: '🇹🇩' },
  { code: 'KM', name: 'Comoros',                  dialCode: '+269', flag: '🇰🇲' },
  { code: 'DJ', name: 'Djibouti',                 dialCode: '+253', flag: '🇩🇯' },
  { code: 'EG', name: 'Egypt',                    dialCode: '+20',  flag: '🇪🇬' },
  { code: 'SZ', name: 'Eswatini',                 dialCode: '+268', flag: '🇸🇿' },
  { code: 'GA', name: 'Gabon',                    dialCode: '+241', flag: '🇬🇦' },
  { code: 'GM', name: 'Gambia',                   dialCode: '+220', flag: '🇬🇲' },
  { code: 'GH', name: 'Ghana',                    dialCode: '+233', flag: '🇬🇭' },
  { code: 'KE', name: 'Kenya',                    dialCode: '+254', flag: '🇰🇪' },
  { code: 'LS', name: 'Lesotho',                  dialCode: '+266', flag: '🇱🇸' },
  { code: 'MG', name: 'Madagascar',               dialCode: '+261', flag: '🇲🇬' },
  { code: 'MW', name: 'Malawi',                   dialCode: '+265', flag: '🇲🇼' },
  { code: 'MR', name: 'Mauritania',               dialCode: '+222', flag: '🇲🇷' },
  { code: 'MU', name: 'Mauritius',                dialCode: '+230', flag: '🇲🇺' },
  { code: 'MA', name: 'Morocco',                  dialCode: '+212', flag: '🇲🇦' },
  { code: 'MZ', name: 'Mozambique',               dialCode: '+258', flag: '🇲🇿' },
  { code: 'NA', name: 'Namibia',                  dialCode: '+264', flag: '🇳🇦' },
  { code: 'NE', name: 'Niger',                    dialCode: '+227', flag: '🇳🇪' },
  { code: 'NG', name: 'Nigeria',                  dialCode: '+234', flag: '🇳🇬' },
  { code: 'RW', name: 'Rwanda',                   dialCode: '+250', flag: '🇷🇼' },
  { code: 'ST', name: 'São Tomé and Príncipe',    dialCode: '+239', flag: '🇸🇹' },
  { code: 'SN', name: 'Senegal',                  dialCode: '+221', flag: '🇸🇳' },
  { code: 'SC', name: 'Seychelles',               dialCode: '+248', flag: '🇸🇨' },
  { code: 'ZA', name: 'South Africa',             dialCode: '+27',  flag: '🇿🇦' },
  { code: 'TZ', name: 'Tanzania',                 dialCode: '+255', flag: '🇹🇿' },
  { code: 'TN', name: 'Tunisia',                  dialCode: '+216', flag: '🇹🇳' },
  { code: 'UG', name: 'Uganda',                   dialCode: '+256', flag: '🇺🇬' },
  // ── Global Allowed ────────────────────────────────────────────────────────
  { code: 'CA', name: 'Canada',                   dialCode: '+1',   flag: '🇨🇦' },
  { code: 'FR', name: 'France',                   dialCode: '+33',  flag: '🇫🇷' },
  { code: 'GB', name: 'United Kingdom',           dialCode: '+44',  flag: '🇬🇧' },
  { code: 'US', name: 'United States',            dialCode: '+1',   flag: '🇺🇸' },
];

/** Popular countries shown at the top of the selector */
export const POPULAR_COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria',        dialCode: '+234', flag: '🇳🇬' },
  { code: 'GH', name: 'Ghana',          dialCode: '+233', flag: '🇬🇭' },
  { code: 'KE', name: 'Kenya',          dialCode: '+254', flag: '🇰🇪' },
  { code: 'ZA', name: 'South Africa',   dialCode: '+27',  flag: '🇿🇦' },
  { code: 'TZ', name: 'Tanzania',       dialCode: '+255', flag: '🇹🇿' },
  { code: 'UG', name: 'Uganda',         dialCode: '+256', flag: '🇺🇬' },
  { code: 'SN', name: 'Senegal',        dialCode: '+221', flag: '🇸🇳' },
  { code: 'CM', name: 'Cameroon',       dialCode: '+237', flag: '🇨🇲' },
  { code: 'RW', name: 'Rwanda',         dialCode: '+250', flag: '🇷🇼' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44',  flag: '🇬🇧' },
  { code: 'US', name: 'United States',  dialCode: '+1',   flag: '🇺🇸' },
  { code: 'CA', name: 'Canada',         dialCode: '+1',   flag: '🇨🇦' },
  { code: 'FR', name: 'France',         dialCode: '+33',  flag: '🇫🇷' },
];

export function getAllowedCountries(): Country[] {
  return ALLOWED_COUNTRIES;
}

export function getPopularCountries(): Country[] {
  return POPULAR_COUNTRIES;
}

export function isCountryAllowed(countryCode: string): boolean {
  return ALLOWED_COUNTRIES.some(c => c.code === countryCode);
}

