/**
 * BorderPay Africa — Country Master Config
 *
 * Single source of truth for all country data in the app. Used by signup,
 * the KYC country selector, profile, and country pickers across the
 * codebase. Do not duplicate this list anywhere else.
 *
 * Provider eligibility:
 *   The active eligibility check for partner product paths is server-side,
 *   in `supabase/functions/_shared/providers/bridge-country-policy.ts`
 *   (mirrored client-side at `utils/compliance/partnerCountryPolicy.ts`).
 *   The `providerSupported` flag below is descriptive metadata used by
 *   country pickers and signup UX; it is NOT consulted by any edge
 *   function. The server-side policy is authoritative.
 *
 * status semantics:
 *   • 'active'       → shown in signup / picker
 *   • 'coming_soon'  → shown with a future-state label
 *   • 'restricted'   → never shown
 */

import { isBridgeBlocked, normalizeBridgeCountryCode } from '../../utils/compliance/partnerCountryPolicy';
import { ALL_COUNTRIES } from '../../utils/countries/allCountries';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface IDType {
  code: string;
  label: string;
  description: string;
  fields: string[];
  /** Identity-document type used by some forms; informational only. */
  identityType: string;
}

export interface CountryConfig {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
  currency: string;
  /** Descriptive only. Partner eligibility comes from bridge-country-policy. */
  providerSupported: boolean;
  /** Hint for an identity-capture flow; not consulted by the live KYC path. */
  verificationMethod: 'eidv' | 'document_capture' | 'none';
  idTypes: IDType[];
  status: 'active' | 'coming_soon' | 'restricted';
}

// ── Restricted-jurisdiction list ────────────────────────────────────────────
// DEPRECATED: this list pre-dates the round-9 Bridge country-policy hardening.
// It overlaps but does not match either Bridge tier. The authoritative
// sources are now:
//   • Prohibited (hard-blocked):        utils/compliance/partnerCountryPolicy.ts
//                                       → BRIDGE_PROHIBITED_COUNTRIES
//   • Controlled (logged-not-blocked):  utils/compliance/partnerCountryPolicy.ts
//                                       → BRIDGE_CONTROLLED_COUNTRIES
//   • Beneficiary/counterparty country: utils/compliance/restrictedJurisdictions.ts
// New consumers should NOT read this list. It is kept only so the single
// internal helper below (isLegacyRestrictedCountry, used in this file)
// continues to compile. Slated for removal once that helper has no callers.

export const LEGACY_RESTRICTED_COUNTRIES: string[] = [
  'AF','AL','AO','BY','BA','MM','BI','CF','CU','KP',
  'CD','ET','ER','GN','GW','HT','IR','IQ','CI','LB',
  'LR','LY','MK','ML','NI','PK','RU','SO','SS','SD',
  'SY','RS','SL','UA','VE','YE','ZW',
];

// ── Country Config ──────────────────────────────────────────────────────────

export const COUNTRY_CONFIG: CountryConfig[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // AFRICA — eIDV (deep data-matching against government databases)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'NG', name: 'Nigeria', flag: '🇳🇬', dialCode: '+234', currency: 'NGN',
    providerSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'BVN', label: 'Bank Verification Number (BVN)', description: '11-digit BVN linked to your bank account', fields: ['idNumber'], identityType: 'BVN' },
      { code: 'NIN', label: 'National Identification Number (NIN)', description: '11-digit NIN from NIMC', fields: ['idNumber'], identityType: 'NIN' },
      { code: 'VNIN', label: 'Virtual NIN (vNIN)', description: 'Virtual NIN generated via NIMC app', fields: ['idNumber'], identityType: 'VNIN' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Nigerian international passport', fields: ['idNumber'], identityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'FRSC-issued Nigerian driver\'s license', fields: ['idNumber'], identityType: 'DRIVERS_LICENSE' },
      { code: 'PVC', label: "Permanent Voter's Card (PVC)", description: 'INEC-issued voter\'s card', fields: ['idNumber'], identityType: 'PVC' },
    ],
  },
  {
    code: 'GH', name: 'Ghana', flag: '🇬🇭', dialCode: '+233', currency: 'GHS',
    providerSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'SSNIT', label: 'SSNIT Number', description: 'Social Security and National Insurance Trust number', fields: ['idNumber'], identityType: 'SSNIT' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Ghanaian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
      { code: 'VOTERS_CARD', label: "Voter's Card", description: 'Ghana Electoral Commission voter ID', fields: ['idNumber'], identityType: 'VOTERS_CARD' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Ghanaian driving license', fields: ['idNumber'], identityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'KE', name: 'Kenya', flag: '🇰🇪', dialCode: '+254', currency: 'KES',
    providerSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National Identity Number', description: 'Kenyan national identity card number', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Kenyan passport', fields: ['idNumber'], identityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Kenyan driving license', fields: ['idNumber'], identityType: 'DRIVERS_LICENSE' },
      { code: 'TAX_PIN', label: 'KRA Tax PIN', description: 'Kenya Revenue Authority PIN', fields: ['idNumber'], identityType: 'TAX_PIN' },
    ],
  },
  {
    code: 'ZA', name: 'South Africa', flag: '🇿🇦', dialCode: '+27', currency: 'ZAR',
    providerSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'South African ID Number', description: '13-digit SA ID number', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'South African passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AFRICA — document capture (manual upload + selfie)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'TZ', name: 'Tanzania', flag: '🇹🇿', dialCode: '+255', currency: 'TZS',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Tanzanian national ID (NIDA)', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Tanzanian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'UG', name: 'Uganda', flag: '🇺🇬', dialCode: '+256', currency: 'UGX',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Ugandan national ID (Ndaga Muntu)', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Ugandan passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'RW', name: 'Rwanda', flag: '🇷🇼', dialCode: '+250', currency: 'RWF',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Rwandan national ID', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Rwandan passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CM', name: 'Cameroon', flag: '🇨🇲', dialCode: '+237', currency: 'XAF',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CNI)', description: 'Cameroon national ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Cameroon passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SN', name: 'Senegal', flag: '🇸🇳', dialCode: '+221', currency: 'XOF',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: "Carte nationale d'identite", fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Senegalese passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BW', name: 'Botswana', flag: '🇧🇼', dialCode: '+267', currency: 'BWP',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (Omang)', description: 'Botswana national ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Botswana passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MU', name: 'Mauritius', flag: '🇲🇺', dialCode: '+230', currency: 'MUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Mauritian national identity card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Mauritian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'EG', name: 'Egypt', flag: '🇪🇬', dialCode: '+20', currency: 'EGP',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Egyptian national ID', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Egyptian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MA', name: 'Morocco', flag: '🇲🇦', dialCode: '+212', currency: 'MAD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CNIE)', description: 'Moroccan CNIE card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Moroccan passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TN', name: 'Tunisia', flag: '🇹🇳', dialCode: '+216', currency: 'TND',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CIN)', description: 'Tunisian CIN', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Tunisian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'DZ', name: 'Algeria', flag: '🇩🇿', dialCode: '+213', currency: 'DZD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Algerian national ID', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Algerian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BF', name: 'Burkina Faso', flag: '🇧🇫', dialCode: '+226', currency: 'XOF',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CNIB)', description: 'Burkinabe CNIB card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Burkina Faso passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MZ', name: 'Mozambique', flag: '🇲🇿', dialCode: '+258', currency: 'MZN',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'International Passport', description: 'Mozambican passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SZ', name: 'Eswatini', flag: '🇸🇿', dialCode: '+268', currency: 'SZL',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID', description: 'Eswatini national ID', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Eswatini passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'US', name: 'United States', flag: '🇺🇸', dialCode: '+1', currency: 'USD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'US Passport', description: 'United States passport', fields: ['idNumber'], identityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'US state driver\'s license', fields: ['idNumber'], identityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dialCode: '+44', currency: 'GBP',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'UK Passport', description: 'British passport', fields: ['idNumber'], identityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'UK driving licence', fields: ['idNumber'], identityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'CA', name: 'Canada', flag: '🇨🇦', dialCode: '+1', currency: 'CAD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Canadian Passport', description: 'Canadian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Canadian provincial driver\'s license', fields: ['idNumber'], identityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'FR', name: 'France', flag: '🇫🇷', dialCode: '+33', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: "Carte d'identite", description: "Carte nationale d'identite", fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passeport', description: 'French passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'DE', name: 'Germany', flag: '🇩🇪', dialCode: '+49', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Personalausweis', description: 'German national ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Reisepass', description: 'German passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IN', name: 'India', flag: '🇮🇳', dialCode: '+91', currency: 'INR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Indian Passport', description: 'Indian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', dialCode: '+971', currency: 'AED',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Emirates ID', description: 'UAE Emirates ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'UAE or foreign passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', dialCode: '+966', currency: 'SAR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID', description: 'Saudi national ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'Saudi passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TR', name: 'Turkey', flag: '🇹🇷', dialCode: '+90', currency: 'TRY',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'TC Kimlik', description: 'Turkish national ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Turkish Passport', description: 'Turkish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IL', name: 'Israel', flag: '🇮🇱', dialCode: '+972', currency: 'ILS',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Teudat Zehut', description: 'Israeli identity card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Israeli Passport', description: 'Israeli passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'JO', name: 'Jordan', flag: '🇯🇴', dialCode: '+962', currency: 'JOD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID', description: 'Jordanian national ID', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Jordanian Passport', description: 'Jordanian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'KW', name: 'Kuwait', flag: '🇰🇼', dialCode: '+965', currency: 'KWD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Civil ID', description: 'Kuwaiti civil identity card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
    ],
  },
  {
    code: 'QA', name: 'Qatar', flag: '🇶🇦', dialCode: '+974', currency: 'QAR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'QID', description: 'Qatar ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'Qatari passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'OM', name: 'Oman', flag: '🇴🇲', dialCode: '+968', currency: 'OMR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Civil ID', description: 'Omani civil ID card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
    ],
  },
  {
    code: 'BH', name: 'Bahrain', flag: '🇧🇭', dialCode: '+973', currency: 'BHD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'CPR Card', description: 'Bahraini Central Population Registry card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AMERICAS — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'BR', name: 'Brazil', flag: '🇧🇷', dialCode: '+55', currency: 'BRL',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Brazilian Passport', description: 'Brazilian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MX', name: 'Mexico', flag: '🇲🇽', dialCode: '+52', currency: 'MXN',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Mexican Passport', description: 'Mexican passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CO', name: 'Colombia', flag: '🇨🇴', dialCode: '+57', currency: 'COP',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Colombian Passport', description: 'Colombian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'AR', name: 'Argentina', flag: '🇦🇷', dialCode: '+54', currency: 'ARS',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Argentine Passport', description: 'Argentine passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CL', name: 'Chile', flag: '🇨🇱', dialCode: '+56', currency: 'CLP',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Chilean Passport', description: 'Chilean passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PE', name: 'Peru', flag: '🇵🇪', dialCode: '+51', currency: 'PEN',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Peruvian Passport', description: 'Peruvian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'JM', name: 'Jamaica', flag: '🇯🇲', dialCode: '+1-876', currency: 'JMD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Jamaican Passport', description: 'Jamaican passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TT', name: 'Trinidad and Tobago', flag: '🇹🇹', dialCode: '+1-868', currency: 'TTD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'TT national ID', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'TT Passport', description: 'Trinidad and Tobago passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EUROPE — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'NL', name: 'Netherlands', flag: '🇳🇱', dialCode: '+31', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'ID Card', description: 'Dutch identity card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'Dutch passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IT', name: 'Italy', flag: '🇮🇹', dialCode: '+39', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: "Carta d'identita", description: 'Italian identity card', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passaporto', description: 'Italian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'ES', name: 'Spain', flag: '🇪🇸', dialCode: '+34', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'DNI', description: 'Documento Nacional de Identidad', fields: ['idNumber'], identityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Pasaporte', description: 'Spanish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PT', name: 'Portugal', flag: '🇵🇹', dialCode: '+351', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passaporte', description: 'Portuguese passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SE', name: 'Sweden', flag: '🇸🇪', dialCode: '+46', currency: 'SEK',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Pass', description: 'Swedish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'NO', name: 'Norway', flag: '🇳🇴', dialCode: '+47', currency: 'NOK',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Norwegian Passport', description: 'Norwegian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'DK', name: 'Denmark', flag: '🇩🇰', dialCode: '+45', currency: 'DKK',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Danish Passport', description: 'Danish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CH', name: 'Switzerland', flag: '🇨🇭', dialCode: '+41', currency: 'CHF',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passport', description: 'Swiss passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'AT', name: 'Austria', flag: '🇦🇹', dialCode: '+43', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Reisepass', description: 'Austrian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BE', name: 'Belgium', flag: '🇧🇪', dialCode: '+32', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passport', description: 'Belgian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IE', name: 'Ireland', flag: '🇮🇪', dialCode: '+353', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Irish Passport', description: 'Irish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MT', name: 'Malta', flag: '🇲🇹', dialCode: '+356', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Maltese Passport', description: 'Maltese passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PL', name: 'Poland', flag: '🇵🇱', dialCode: '+48', currency: 'PLN',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Paszport', description: 'Polish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'FI', name: 'Finland', flag: '🇫🇮', dialCode: '+358', currency: 'EUR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passi', description: 'Finnish passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ASIA-PACIFIC — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'AU', name: 'Australia', flag: '🇦🇺', dialCode: '+61', currency: 'AUD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Australian Passport', description: 'Australian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'NZ', name: 'New Zealand', flag: '🇳🇿', dialCode: '+64', currency: 'NZD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'NZ Passport', description: 'New Zealand passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SG', name: 'Singapore', flag: '🇸🇬', dialCode: '+65', currency: 'SGD',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Singapore Passport', description: 'Singaporean passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'JP', name: 'Japan', flag: '🇯🇵', dialCode: '+81', currency: 'JPY',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Japanese Passport', description: 'Japanese passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'KR', name: 'South Korea', flag: '🇰🇷', dialCode: '+82', currency: 'KRW',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Korean Passport', description: 'Republic of Korea passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MY', name: 'Malaysia', flag: '🇲🇾', dialCode: '+60', currency: 'MYR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Malaysian Passport', description: 'Malaysian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PH', name: 'Philippines', flag: '🇵🇭', dialCode: '+63', currency: 'PHP',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Philippine Passport', description: 'Philippine passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TH', name: 'Thailand', flag: '🇹🇭', dialCode: '+66', currency: 'THB',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Thai Passport', description: 'Thai passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'ID', name: 'Indonesia', flag: '🇮🇩', dialCode: '+62', currency: 'IDR',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Indonesian Passport', description: 'Indonesian passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BD', name: 'Bangladesh', flag: '🇧🇩', dialCode: '+880', currency: 'BDT',
    providerSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Bangladeshi Passport', description: 'Bangladeshi passport', fields: ['idNumber'], identityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AFRICA — future-state via planned local rails partner (NOT Bridge)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Bridge's supported-countries list categorises COD (DRC) as PROHIBITED
  // (no US ACH / FedWire / SEPA / FPS support). We allow account signup so
  // DRC residents can register, but Bridge KYC/KYB and money-movement flows
  // are blocked server-side. See bridge-customer / bridge-kyc-link /
  // bridge-kyb-link for the `country_not_supported` 403 guard.
  {
    code: 'CD', name: 'Democratic Republic of the Congo', flag: '🇨🇩', dialCode: '+243', currency: 'CDF',
    providerSupported: false, verificationMethod: 'none',
    status: 'active',
    idTypes: [],
  },
];

// ── Helper Functions — use these EVERYWHERE ─────────────────────────────────

export const getActiveCountries = (): CountryConfig[] =>
  COUNTRY_CONFIG.filter(c => c.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));

/** Active countries that are also eligible for Bridge onboarding.
 *  Source for the signup picker. Onboarding eligibility only —
 *  rail availability is gated separately. */
export const getSignupEligibleCountries = (): CountryConfig[] =>
  getActiveCountries().filter(c => !isBridgeBlocked(c.code));

export const getComingSoonCountries = (): CountryConfig[] =>
  COUNTRY_CONFIG.filter(c => c.status === 'coming_soon')
    .sort((a, b) => a.name.localeCompare(b.name));

/** All countries safe to display (excludes restricted) */
export const getAllDisplayCountries = (): CountryConfig[] =>
  COUNTRY_CONFIG.filter(c => c.status !== 'restricted')
    .sort((a, b) => a.name.localeCompare(b.name));

export const getCountryByCode = (code: string): CountryConfig | undefined =>
  COUNTRY_CONFIG.find(c => c.code === code);

export const isRestricted = (code: string): boolean =>
  LEGACY_RESTRICTED_COUNTRIES.includes(code);

/** Popular countries shown at top of selectors */
export const POPULAR_COUNTRY_CODES = ['NG', 'GH', 'KE', 'ZA', 'TZ', 'UG', 'GB', 'US', 'CA', 'FR'];

export const getPopularCountries = (): CountryConfig[] =>
  POPULAR_COUNTRY_CODES
    .map(code => COUNTRY_CONFIG.find(c => c.code === code))
    .filter((c): c is CountryConfig => !!c);

const normalizeCountryName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const COUNTRY_NAME_TO_CODE = new Map<string, string>(
  ALL_COUNTRIES.map((c) => [normalizeCountryName(c.name), c.code]),
);

const COUNTRY_NAME_ALIASES: Record<string, string> = {
  'democratic republic of the congo': 'CD',
  'congo democratic republic of the': 'CD',
  'congo kinshasa': 'CD',
  'congo brazzaville': 'CG',
  'cabo verde': 'CV',
  "cote d ivoire": 'CI',
  "cote d'ivoire": 'CI',
  'ivory coast': 'CI',
  'united states of america': 'US',
  'great britain': 'GB',
};

const GENERIC_ID_TYPES: IDType[] = [
  {
    code: 'PASSPORT',
    label: 'Passport',
    description: 'Valid international passport',
    fields: ['idNumber'],
    identityType: 'PASSPORT',
  },
  {
    code: 'NATIONAL_ID',
    label: 'National ID',
    description: 'Government-issued national identity document',
    fields: ['idNumber'],
    identityType: 'NATIONAL_ID',
  },
];

function flagFromCode(code: string): string {
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...code.split('').map((char) => 127397 + char.charCodeAt(0)))
    : '';
}

function countryConfigFromCode(code: string, providerName = ''): CountryConfig | null {
  const fromConfig = getCountryByCode(code);
  if (fromConfig) return { ...fromConfig, providerSupported: true, status: 'active' };

  const fromAll = ALL_COUNTRIES.find((c) => c.code === code);
  if (!fromAll && !providerName) return null;

  return {
    code,
    name: fromAll?.name ?? providerName,
    flag: fromAll?.flag ?? flagFromCode(code),
    dialCode: fromAll?.dialCode ?? '',
    currency: '',
    providerSupported: true,
    verificationMethod: 'document_capture',
    idTypes: GENERIC_ID_TYPES,
    status: 'active',
  };
}

function resolveCode2(input: unknown): string | null {
  const code = String(input ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function getSignupCountriesFromBridge(records: Array<{ code?: string | null; code3?: string | null; name?: string | null }>): CountryConfig[] {
  const out = new Map<string, CountryConfig>();

  for (const row of records) {
    let code = resolveCode2(row?.code) ?? normalizeBridgeCountryCode(row?.code3);
    const rawName = String(row?.name ?? '').trim();
    if (!code && rawName) {
      const normalized = normalizeCountryName(rawName);
      code = COUNTRY_NAME_TO_CODE.get(normalized)
        ?? COUNTRY_NAME_ALIASES[normalized]
        ?? null;
    }
    if (!code) continue;
    if (isBridgeBlocked(code)) continue;
    const cfg = countryConfigFromCode(code, rawName);
    if (!cfg) continue;
    out.set(code, cfg);
  }

  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
}
