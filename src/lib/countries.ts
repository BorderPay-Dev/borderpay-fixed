/**
 * BorderPay Africa — Country Master Config
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for all country data in the app.
 * Used by: signup, KYC country selector, profile, everywhere.
 * NEVER create another country list anywhere in the codebase.
 *
 * Built from:
 *  - Maplerad restricted jurisdictions (44 countries/territories)
 *  - Maplerad-supported issuing/identity coverage
 *
 * Rules:
 *  - status: 'active'      → Maplerad accepts enrollment from this country
 *  - status: 'coming_soon' → Maplerad does not yet support this country
 *  - status: 'restricted'  → Maplerad banned — NEVER show to users
 */

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface IDType {
  code: string;
  label: string;
  description: string;
  fields: string[];
  /** Exact value to send to Maplerad enroll API identity.type */
  mapleradIdentityType: string;
}

export interface CountryConfig {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
  currency: string;
  mapleradSupported: boolean;
  /**
   * Hint for what kind of identity capture this country needs. The custom
   * KYC flow always collects an ID image + selfie + POA regardless, but this
   * tag is kept so the UI can tailor copy ("scan your ID" vs "type your BVN").
   */
  verificationMethod: 'eidv' | 'document_capture' | 'none';
  idTypes: IDType[];
  status: 'active' | 'coming_soon' | 'restricted';
}

// ── Maplerad Restricted Jurisdictions ────────────────────────────────────────

export const MAPLERAD_RESTRICTED: string[] = [
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
    mapleradSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'BVN', label: 'Bank Verification Number (BVN)', description: '11-digit BVN linked to your bank account', fields: ['idNumber'], mapleradIdentityType: 'BVN' },
      { code: 'NIN', label: 'National Identification Number (NIN)', description: '11-digit NIN from NIMC', fields: ['idNumber'], mapleradIdentityType: 'NIN' },
      { code: 'VNIN', label: 'Virtual NIN (vNIN)', description: 'Virtual NIN generated via NIMC app', fields: ['idNumber'], mapleradIdentityType: 'VNIN' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Nigerian international passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'FRSC-issued Nigerian driver\'s license', fields: ['idNumber'], mapleradIdentityType: 'DRIVERS_LICENSE' },
      { code: 'PVC', label: "Permanent Voter's Card (PVC)", description: 'INEC-issued voter\'s card', fields: ['idNumber'], mapleradIdentityType: 'PVC' },
    ],
  },
  {
    code: 'GH', name: 'Ghana', flag: '🇬🇭', dialCode: '+233', currency: 'GHS',
    mapleradSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'SSNIT', label: 'SSNIT Number', description: 'Social Security and National Insurance Trust number', fields: ['idNumber'], mapleradIdentityType: 'SSNIT' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Ghanaian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
      { code: 'VOTERS_CARD', label: "Voter's Card", description: 'Ghana Electoral Commission voter ID', fields: ['idNumber'], mapleradIdentityType: 'VOTERS_CARD' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Ghanaian driving license', fields: ['idNumber'], mapleradIdentityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'KE', name: 'Kenya', flag: '🇰🇪', dialCode: '+254', currency: 'KES',
    mapleradSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National Identity Number', description: 'Kenyan national identity card number', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Kenyan passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Kenyan driving license', fields: ['idNumber'], mapleradIdentityType: 'DRIVERS_LICENSE' },
      { code: 'TAX_PIN', label: 'KRA Tax PIN', description: 'Kenya Revenue Authority PIN', fields: ['idNumber'], mapleradIdentityType: 'TAX_PIN' },
    ],
  },
  {
    code: 'ZA', name: 'South Africa', flag: '🇿🇦', dialCode: '+27', currency: 'ZAR',
    mapleradSupported: true, verificationMethod: 'eidv',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'South African ID Number', description: '13-digit SA ID number', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'South African passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AFRICA — document capture (manual upload + selfie)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'TZ', name: 'Tanzania', flag: '🇹🇿', dialCode: '+255', currency: 'TZS',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Tanzanian national ID (NIDA)', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Tanzanian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'UG', name: 'Uganda', flag: '🇺🇬', dialCode: '+256', currency: 'UGX',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Ugandan national ID (Ndaga Muntu)', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Ugandan passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'RW', name: 'Rwanda', flag: '🇷🇼', dialCode: '+250', currency: 'RWF',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Rwandan national ID', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Rwandan passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CM', name: 'Cameroon', flag: '🇨🇲', dialCode: '+237', currency: 'XAF',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CNI)', description: 'Cameroon national ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Cameroon passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SN', name: 'Senegal', flag: '🇸🇳', dialCode: '+221', currency: 'XOF',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: "Carte nationale d'identite", fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Senegalese passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BW', name: 'Botswana', flag: '🇧🇼', dialCode: '+267', currency: 'BWP',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (Omang)', description: 'Botswana national ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Botswana passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MU', name: 'Mauritius', flag: '🇲🇺', dialCode: '+230', currency: 'MUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Mauritian national identity card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Mauritian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'EG', name: 'Egypt', flag: '🇪🇬', dialCode: '+20', currency: 'EGP',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Egyptian national ID', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Egyptian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MA', name: 'Morocco', flag: '🇲🇦', dialCode: '+212', currency: 'MAD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CNIE)', description: 'Moroccan CNIE card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Moroccan passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TN', name: 'Tunisia', flag: '🇹🇳', dialCode: '+216', currency: 'TND',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CIN)', description: 'Tunisian CIN', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Tunisian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'DZ', name: 'Algeria', flag: '🇩🇿', dialCode: '+213', currency: 'DZD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'Algerian national ID', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Algerian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BF', name: 'Burkina Faso', flag: '🇧🇫', dialCode: '+226', currency: 'XOF',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card (CNIB)', description: 'Burkinabe CNIB card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Burkina Faso passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MZ', name: 'Mozambique', flag: '🇲🇿', dialCode: '+258', currency: 'MZN',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'International Passport', description: 'Mozambican passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SZ', name: 'Eswatini', flag: '🇸🇿', dialCode: '+268', currency: 'SZL',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID', description: 'Eswatini national ID', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'International Passport', description: 'Eswatini passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'US', name: 'United States', flag: '🇺🇸', dialCode: '+1', currency: 'USD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'US Passport', description: 'United States passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'US state driver\'s license', fields: ['idNumber'], mapleradIdentityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dialCode: '+44', currency: 'GBP',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'UK Passport', description: 'British passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'UK driving licence', fields: ['idNumber'], mapleradIdentityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'CA', name: 'Canada', flag: '🇨🇦', dialCode: '+1', currency: 'CAD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Canadian Passport', description: 'Canadian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
      { code: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Canadian provincial driver\'s license', fields: ['idNumber'], mapleradIdentityType: 'DRIVERS_LICENSE' },
    ],
  },
  {
    code: 'FR', name: 'France', flag: '🇫🇷', dialCode: '+33', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: "Carte d'identite", description: "Carte nationale d'identite", fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passeport', description: 'French passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'DE', name: 'Germany', flag: '🇩🇪', dialCode: '+49', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Personalausweis', description: 'German national ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Reisepass', description: 'German passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IN', name: 'India', flag: '🇮🇳', dialCode: '+91', currency: 'INR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Indian Passport', description: 'Indian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', dialCode: '+971', currency: 'AED',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Emirates ID', description: 'UAE Emirates ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'UAE or foreign passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', dialCode: '+966', currency: 'SAR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID', description: 'Saudi national ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'Saudi passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TR', name: 'Turkey', flag: '🇹🇷', dialCode: '+90', currency: 'TRY',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'TC Kimlik', description: 'Turkish national ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Turkish Passport', description: 'Turkish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IL', name: 'Israel', flag: '🇮🇱', dialCode: '+972', currency: 'ILS',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Teudat Zehut', description: 'Israeli identity card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Israeli Passport', description: 'Israeli passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'JO', name: 'Jordan', flag: '🇯🇴', dialCode: '+962', currency: 'JOD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID', description: 'Jordanian national ID', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Jordanian Passport', description: 'Jordanian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'KW', name: 'Kuwait', flag: '🇰🇼', dialCode: '+965', currency: 'KWD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Civil ID', description: 'Kuwaiti civil identity card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
    ],
  },
  {
    code: 'QA', name: 'Qatar', flag: '🇶🇦', dialCode: '+974', currency: 'QAR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'QID', description: 'Qatar ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'Qatari passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'OM', name: 'Oman', flag: '🇴🇲', dialCode: '+968', currency: 'OMR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'Civil ID', description: 'Omani civil ID card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
    ],
  },
  {
    code: 'BH', name: 'Bahrain', flag: '🇧🇭', dialCode: '+973', currency: 'BHD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'CPR Card', description: 'Bahraini Central Population Registry card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AMERICAS — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'BR', name: 'Brazil', flag: '🇧🇷', dialCode: '+55', currency: 'BRL',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Brazilian Passport', description: 'Brazilian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MX', name: 'Mexico', flag: '🇲🇽', dialCode: '+52', currency: 'MXN',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Mexican Passport', description: 'Mexican passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CO', name: 'Colombia', flag: '🇨🇴', dialCode: '+57', currency: 'COP',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Colombian Passport', description: 'Colombian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'AR', name: 'Argentina', flag: '🇦🇷', dialCode: '+54', currency: 'ARS',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Argentine Passport', description: 'Argentine passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CL', name: 'Chile', flag: '🇨🇱', dialCode: '+56', currency: 'CLP',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Chilean Passport', description: 'Chilean passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PE', name: 'Peru', flag: '🇵🇪', dialCode: '+51', currency: 'PEN',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Peruvian Passport', description: 'Peruvian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'JM', name: 'Jamaica', flag: '🇯🇲', dialCode: '+1-876', currency: 'JMD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Jamaican Passport', description: 'Jamaican passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TT', name: 'Trinidad and Tobago', flag: '🇹🇹', dialCode: '+1-868', currency: 'TTD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'National ID Card', description: 'TT national ID', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'TT Passport', description: 'Trinidad and Tobago passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EUROPE — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'NL', name: 'Netherlands', flag: '🇳🇱', dialCode: '+31', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'ID Card', description: 'Dutch identity card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passport', description: 'Dutch passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IT', name: 'Italy', flag: '🇮🇹', dialCode: '+39', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: "Carta d'identita", description: 'Italian identity card', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Passaporto', description: 'Italian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'ES', name: 'Spain', flag: '🇪🇸', dialCode: '+34', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'NATIONAL_ID', label: 'DNI', description: 'Documento Nacional de Identidad', fields: ['idNumber'], mapleradIdentityType: 'NATIONAL_ID' },
      { code: 'PASSPORT', label: 'Pasaporte', description: 'Spanish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PT', name: 'Portugal', flag: '🇵🇹', dialCode: '+351', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passaporte', description: 'Portuguese passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SE', name: 'Sweden', flag: '🇸🇪', dialCode: '+46', currency: 'SEK',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Pass', description: 'Swedish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'NO', name: 'Norway', flag: '🇳🇴', dialCode: '+47', currency: 'NOK',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Norwegian Passport', description: 'Norwegian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'DK', name: 'Denmark', flag: '🇩🇰', dialCode: '+45', currency: 'DKK',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Danish Passport', description: 'Danish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'CH', name: 'Switzerland', flag: '🇨🇭', dialCode: '+41', currency: 'CHF',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passport', description: 'Swiss passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'AT', name: 'Austria', flag: '🇦🇹', dialCode: '+43', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Reisepass', description: 'Austrian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BE', name: 'Belgium', flag: '🇧🇪', dialCode: '+32', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passport', description: 'Belgian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'IE', name: 'Ireland', flag: '🇮🇪', dialCode: '+353', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Irish Passport', description: 'Irish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PL', name: 'Poland', flag: '🇵🇱', dialCode: '+48', currency: 'PLN',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Paszport', description: 'Polish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'FI', name: 'Finland', flag: '🇫🇮', dialCode: '+358', currency: 'EUR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Passi', description: 'Finnish passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ASIA-PACIFIC — document capture
  // ═══════════════════════════════════════════════════════════════════════════

  {
    code: 'AU', name: 'Australia', flag: '🇦🇺', dialCode: '+61', currency: 'AUD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Australian Passport', description: 'Australian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'NZ', name: 'New Zealand', flag: '🇳🇿', dialCode: '+64', currency: 'NZD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'NZ Passport', description: 'New Zealand passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'SG', name: 'Singapore', flag: '🇸🇬', dialCode: '+65', currency: 'SGD',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Singapore Passport', description: 'Singaporean passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'JP', name: 'Japan', flag: '🇯🇵', dialCode: '+81', currency: 'JPY',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Japanese Passport', description: 'Japanese passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'KR', name: 'South Korea', flag: '🇰🇷', dialCode: '+82', currency: 'KRW',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Korean Passport', description: 'Republic of Korea passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'MY', name: 'Malaysia', flag: '🇲🇾', dialCode: '+60', currency: 'MYR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Malaysian Passport', description: 'Malaysian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'PH', name: 'Philippines', flag: '🇵🇭', dialCode: '+63', currency: 'PHP',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Philippine Passport', description: 'Philippine passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'TH', name: 'Thailand', flag: '🇹🇭', dialCode: '+66', currency: 'THB',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Thai Passport', description: 'Thai passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'ID', name: 'Indonesia', flag: '🇮🇩', dialCode: '+62', currency: 'IDR',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Indonesian Passport', description: 'Indonesian passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
  {
    code: 'BD', name: 'Bangladesh', flag: '🇧🇩', dialCode: '+880', currency: 'BDT',
    mapleradSupported: true, verificationMethod: 'document_capture',
    status: 'active',
    idTypes: [
      { code: 'PASSPORT', label: 'Bangladeshi Passport', description: 'Bangladeshi passport', fields: ['idNumber'], mapleradIdentityType: 'PASSPORT' },
    ],
  },
];

// ── Helper Functions — use these EVERYWHERE ─────────────────────────────────

export const getActiveCountries = (): CountryConfig[] =>
  COUNTRY_CONFIG.filter(c => c.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));

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
  MAPLERAD_RESTRICTED.includes(code);

/** Popular countries shown at top of selectors */
export const POPULAR_COUNTRY_CODES = ['NG', 'GH', 'KE', 'ZA', 'TZ', 'UG', 'GB', 'US', 'CA', 'FR'];

export const getPopularCountries = (): CountryConfig[] =>
  POPULAR_COUNTRY_CODES
    .map(code => COUNTRY_CONFIG.find(c => c.code === code))
    .filter((c): c is CountryConfig => !!c);
