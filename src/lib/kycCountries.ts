/**
 * BorderPay Africa — KYC Country Matrix
 *
 * Cross-references Maplerad customer enrollment support with Youverify
 * identity verification coverage to determine which countries are fully
 * supported, and which are coming soon.
 *
 * Rules:
 *  - Maplerad accepts any ISO 3166-1 alpha-2 country code NOT on their
 *    restricted jurisdictions list.
 *  - Youverify has eIDV (data-matching) for NG, KE, GH, ZA plus global
 *    document capture for 130+ countries.
 *  - status: 'supported'    → both Maplerad + Youverify cover it
 *  - status: 'coming_soon'  → Maplerad allows but Youverify has no coverage
 *  - Countries on Maplerad restricted list are excluded entirely.
 */

export interface KYCIdType {
  id: string;
  label: string;
  description: string;
  /** Fields required in the KYC submission form for this ID type */
  fields: string[];
}

export interface KYCCountry {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
  status: 'supported' | 'coming_soon';
  /** Available ID types — only populated for 'supported' countries */
  idTypes: KYCIdType[];
}

/**
 * Maplerad restricted jurisdictions — customers from these countries
 * cannot be enrolled. They are NOT included in KYC_COUNTRIES.
 */
export const MAPLERAD_RESTRICTED: string[] = [
  'AF','AL','AO','BY','BA','MM','BI','CF','CU','KP',
  'CD','ET','ER','GN','GW','HT','IR','IQ','CI','LB',
  'LR','LY','MK','ML','NI','PK','RU','SO','SS','SD',
  'SY','RS','SL','UA','VE','YE','ZW',
];

// ── Deep eIDV countries (Youverify data-matching) ──────────────────────────

export const KYC_COUNTRIES: KYCCountry[] = [
  // ─── AFRICA — deep eIDV ──────────────────────────────────────────────────
  {
    code: 'NG', name: 'Nigeria', flag: '\u{1F1F3}\u{1F1EC}', dialCode: '+234',
    status: 'supported',
    idTypes: [
      { id: 'BVN', label: 'Bank Verification Number (BVN)', description: '11-digit BVN linked to your bank account', fields: ['identification_number'] },
      { id: 'NIN', label: 'National Identification Number (NIN)', description: '11-digit NIN from NIMC', fields: ['identification_number'] },
      { id: 'vNIN', label: 'Virtual NIN (vNIN)', description: 'Virtual NIN generated via NIMC app', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Nigerian international passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Nigerian driving license', fields: ['identification_number'] },
      { id: 'PVC', label: "Permanent Voter's Card", description: 'PVC from INEC', fields: ['identification_number'] },
    ],
  },
  {
    code: 'GH', name: 'Ghana', flag: '\u{1F1EC}\u{1F1ED}', dialCode: '+233',
    status: 'supported',
    idTypes: [
      { id: 'SSNIT', label: 'SSNIT Number', description: 'Social Security and National Insurance Trust number', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Ghanaian passport', fields: ['identification_number'] },
      { id: 'VOTERS_CARD', label: "Voter's Card", description: 'Ghana Electoral Commission voter ID', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Ghanaian driving license', fields: ['identification_number'] },
    ],
  },
  {
    code: 'KE', name: 'Kenya', flag: '\u{1F1F0}\u{1F1EA}', dialCode: '+254',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID', description: 'Kenyan national identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Kenyan passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Kenyan driving license', fields: ['identification_number'] },
      { id: 'TAX_PIN', label: 'KRA Tax PIN', description: 'Kenya Revenue Authority PIN', fields: ['identification_number'] },
    ],
  },
  {
    code: 'ZA', name: 'South Africa', flag: '\u{1F1FF}\u{1F1E6}', dialCode: '+27',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'South African ID Number', description: '13-digit SA ID number', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'South African passport', fields: ['identification_number'] },
    ],
  },

  // ─── AFRICA — document capture ───────────────────────────────────────────
  {
    code: 'TZ', name: 'Tanzania', flag: '\u{1F1F9}\u{1F1FF}', dialCode: '+255',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Tanzanian national ID (NIDA)', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Tanzanian passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Tanzanian driving license', fields: ['identification_number'] },
    ],
  },
  {
    code: 'UG', name: 'Uganda', flag: '\u{1F1FA}\u{1F1EC}', dialCode: '+256',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Ugandan national ID (Ndaga Muntu)', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Ugandan driving license', fields: ['identification_number'] },
    ],
  },
  {
    code: 'RW', name: 'Rwanda', flag: '\u{1F1F7}\u{1F1FC}', dialCode: '+250',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Rwandan national ID', fields: ['identification_number'] },
    ],
  },
  {
    code: 'CM', name: 'Cameroon', flag: '\u{1F1E8}\u{1F1F2}', dialCode: '+237',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Cameroon national ID card (CNI)', fields: ['identification_number'] },
    ],
  },
  {
    code: 'SN', name: 'Senegal', flag: '\u{1F1F8}\u{1F1F3}', dialCode: '+221',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: "Carte nationale d'identité", fields: ['identification_number'] },
    ],
  },
  {
    code: 'MZ', name: 'Mozambique', flag: '\u{1F1F2}\u{1F1FF}', dialCode: '+258',
    status: 'supported',
    idTypes: [
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: "Valid Mozambican driving license", fields: ['identification_number'] },
    ],
  },
  {
    code: 'BW', name: 'Botswana', flag: '\u{1F1E7}\u{1F1FC}', dialCode: '+267',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card (Omang)', description: 'Botswana national ID card', fields: ['identification_number'] },
    ],
  },
  {
    code: 'MU', name: 'Mauritius', flag: '\u{1F1F2}\u{1F1FA}', dialCode: '+230',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Mauritian national identity card', fields: ['identification_number'] },
    ],
  },
  {
    code: 'EG', name: 'Egypt', flag: '\u{1F1EA}\u{1F1EC}', dialCode: '+20',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Egyptian national ID', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Egyptian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'MA', name: 'Morocco', flag: '\u{1F1F2}\u{1F1E6}', dialCode: '+212',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card (CNIE)', description: 'Moroccan CNIE card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Moroccan passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Valid Moroccan driving license', fields: ['identification_number'] },
    ],
  },
  {
    code: 'TN', name: 'Tunisia', flag: '\u{1F1F9}\u{1F1F3}', dialCode: '+216',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card (CIN)', description: 'Tunisian CIN', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Tunisian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'DZ', name: 'Algeria', flag: '\u{1F1E9}\u{1F1FF}', dialCode: '+213',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'Algerian national ID', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'International Passport', description: 'Algerian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'BF', name: 'Burkina Faso', flag: '\u{1F1E7}\u{1F1EB}', dialCode: '+226',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card (CNIB)', description: 'Burkinabe CNIB card', fields: ['identification_number'] },
    ],
  },

  // ─── GLOBAL — key markets with document capture ──────────────────────────
  {
    code: 'US', name: 'United States', flag: '\u{1F1FA}\u{1F1F8}', dialCode: '+1',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'US Passport', description: 'United States passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'US state driver\'s license', fields: ['identification_number'] },
      { id: 'SSN', label: 'Social Security Number', description: 'US Social Security Number (SSN)', fields: ['identification_number'] },
    ],
  },
  {
    code: 'GB', name: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}', dialCode: '+44',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'UK Passport', description: 'British passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'UK driving licence', fields: ['identification_number'] },
    ],
  },
  {
    code: 'CA', name: 'Canada', flag: '\u{1F1E8}\u{1F1E6}', dialCode: '+1',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'Canadian Passport', description: 'Canadian passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Canadian provincial driver\'s license', fields: ['identification_number'] },
    ],
  },
  {
    code: 'AU', name: 'Australia', flag: '\u{1F1E6}\u{1F1FA}', dialCode: '+61',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'Australian Passport', description: 'Australian passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Australian state driver\'s licence', fields: ['identification_number'] },
    ],
  },
  {
    code: 'DE', name: 'Germany', flag: '\u{1F1E9}\u{1F1EA}', dialCode: '+49',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Personalausweis', description: 'German national ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Reisepass', description: 'German passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'FR', name: 'France', flag: '\u{1F1EB}\u{1F1F7}', dialCode: '+33',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: "Carte d'identité", description: "Carte nationale d'identité", fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passeport', description: 'French passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'IN', name: 'India', flag: '\u{1F1EE}\u{1F1F3}', dialCode: '+91',
    status: 'supported',
    idTypes: [
      { id: 'AADHAAR', label: 'Aadhaar Card', description: '12-digit Aadhaar number', fields: ['identification_number'] },
      { id: 'PAN', label: 'PAN Card', description: 'Permanent Account Number', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Indian Passport', description: 'Indian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'BR', name: 'Brazil', flag: '\u{1F1E7}\u{1F1F7}', dialCode: '+55',
    status: 'supported',
    idTypes: [
      { id: 'CPF', label: 'CPF', description: 'Cadastro de Pessoas Físicas', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Brazilian Passport', description: 'Brazilian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'MX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}', dialCode: '+52',
    status: 'supported',
    idTypes: [
      { id: 'INE', label: 'INE/IFE Voter ID', description: 'Mexican voter identification', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Mexican Passport', description: 'Mexican passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'AE', name: 'United Arab Emirates', flag: '\u{1F1E6}\u{1F1EA}', dialCode: '+971',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Emirates ID', description: 'UAE Emirates ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passport', description: 'UAE or foreign passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'SA', name: 'Saudi Arabia', flag: '\u{1F1F8}\u{1F1E6}', dialCode: '+966',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID', description: 'Saudi national ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passport', description: 'Saudi passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'SG', name: 'Singapore', flag: '\u{1F1F8}\u{1F1EC}', dialCode: '+65',
    status: 'supported',
    idTypes: [
      { id: 'NRIC', label: 'NRIC', description: 'National Registration Identity Card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Singapore Passport', description: 'Singaporean passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'JP', name: 'Japan', flag: '\u{1F1EF}\u{1F1F5}', dialCode: '+81',
    status: 'supported',
    idTypes: [
      { id: 'MY_NUMBER', label: 'My Number Card', description: 'Japanese My Number identification', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Japanese Passport', description: 'Japanese passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'KR', name: 'South Korea', flag: '\u{1F1F0}\u{1F1F7}', dialCode: '+82',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Resident Registration Card', description: 'Korean resident registration', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Korean Passport', description: 'Republic of Korea passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'NZ', name: 'New Zealand', flag: '\u{1F1F3}\u{1F1FF}', dialCode: '+64',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'NZ Passport', description: 'New Zealand passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's Licence", description: 'NZ driver licence', fields: ['identification_number'] },
    ],
  },
  {
    code: 'IL', name: 'Israel', flag: '\u{1F1EE}\u{1F1F1}', dialCode: '+972',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Teudat Zehut', description: 'Israeli identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Israeli Passport', description: 'Israeli passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'TR', name: 'Turkey', flag: '\u{1F1F9}\u{1F1F7}', dialCode: '+90',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'TC Kimlik', description: 'Turkish national ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Turkish Passport', description: 'Turkish passport', fields: ['identification_number'] },
    ],
  },

  // ─── LATIN AMERICA — document capture ────────────────────────────────────
  {
    code: 'CO', name: 'Colombia', flag: '\u{1F1E8}\u{1F1F4}', dialCode: '+57',
    status: 'supported',
    idTypes: [
      { id: 'CEDULA', label: 'Cédula de Ciudadanía', description: 'Colombian citizen ID', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Colombian Passport', description: 'Colombian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'CL', name: 'Chile', flag: '\u{1F1E8}\u{1F1F1}', dialCode: '+56',
    status: 'supported',
    idTypes: [
      { id: 'RUT', label: 'RUT/RUN', description: 'Chilean national identification', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Chilean Passport', description: 'Chilean passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'PE', name: 'Peru', flag: '\u{1F1F5}\u{1F1EA}', dialCode: '+51',
    status: 'supported',
    idTypes: [
      { id: 'DNI', label: 'DNI', description: 'Documento Nacional de Identidad', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Peruvian Passport', description: 'Peruvian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'AR', name: 'Argentina', flag: '\u{1F1E6}\u{1F1F7}', dialCode: '+54',
    status: 'supported',
    idTypes: [
      { id: 'DNI', label: 'DNI', description: 'Documento Nacional de Identidad', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Argentine Passport', description: 'Argentine passport', fields: ['identification_number'] },
    ],
  },

  // ─── EUROPE — document capture ───────────────────────────────────────────
  {
    code: 'NL', name: 'Netherlands', flag: '\u{1F1F3}\u{1F1F1}', dialCode: '+31',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'ID Card', description: 'Dutch identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passport', description: 'Dutch passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'IT', name: 'Italy', flag: '\u{1F1EE}\u{1F1F9}', dialCode: '+39',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: "Carta d'identità", description: 'Italian identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passaporto', description: 'Italian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'ES', name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}', dialCode: '+34',
    status: 'supported',
    idTypes: [
      { id: 'DNI', label: 'DNI', description: 'Documento Nacional de Identidad', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Pasaporte', description: 'Spanish passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'PT', name: 'Portugal', flag: '\u{1F1F5}\u{1F1F9}', dialCode: '+351',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Cartão de Cidadão', description: 'Portuguese citizen card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passaporte', description: 'Portuguese passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'SE', name: 'Sweden', flag: '\u{1F1F8}\u{1F1EA}', dialCode: '+46',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'ID Card', description: 'Swedish ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Pass', description: 'Swedish passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'NO', name: 'Norway', flag: '\u{1F1F3}\u{1F1F4}', dialCode: '+47',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'Norwegian Passport', description: 'Norwegian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'DK', name: 'Denmark', flag: '\u{1F1E9}\u{1F1F0}', dialCode: '+45',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'Danish Passport', description: 'Danish passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'CH', name: 'Switzerland', flag: '\u{1F1E8}\u{1F1ED}', dialCode: '+41',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Identitätskarte', description: 'Swiss identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passport', description: 'Swiss passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'AT', name: 'Austria', flag: '\u{1F1E6}\u{1F1F9}', dialCode: '+43',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Personalausweis', description: 'Austrian ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Reisepass', description: 'Austrian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'BE', name: 'Belgium', flag: '\u{1F1E7}\u{1F1EA}', dialCode: '+32',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'eID Card', description: 'Belgian electronic identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passport', description: 'Belgian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'IE', name: 'Ireland', flag: '\u{1F1EE}\u{1F1EA}', dialCode: '+353',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'Irish Passport', description: 'Irish passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'PL', name: 'Poland', flag: '\u{1F1F5}\u{1F1F1}', dialCode: '+48',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Dowód osobisty', description: 'Polish identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Paszport', description: 'Polish passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'CZ', name: 'Czech Republic', flag: '\u{1F1E8}\u{1F1FF}', dialCode: '+420',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Občanský průkaz', description: 'Czech identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Cestovní pas', description: 'Czech passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'FI', name: 'Finland', flag: '\u{1F1EB}\u{1F1EE}', dialCode: '+358',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Henkilökortti', description: 'Finnish ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passi', description: 'Finnish passport', fields: ['identification_number'] },
    ],
  },

  // ─── ASIA — document capture ─────────────────────────────────────────────
  {
    code: 'MY', name: 'Malaysia', flag: '\u{1F1F2}\u{1F1FE}', dialCode: '+60',
    status: 'supported',
    idTypes: [
      { id: 'MYKAD', label: 'MyKad', description: 'Malaysian identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Malaysian Passport', description: 'Malaysian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'PH', name: 'Philippines', flag: '\u{1F1F5}\u{1F1ED}', dialCode: '+63',
    status: 'supported',
    idTypes: [
      { id: 'PASSPORT', label: 'Philippine Passport', description: 'Philippine passport', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's License", description: 'Philippine driver\'s license', fields: ['identification_number'] },
    ],
  },
  {
    code: 'TH', name: 'Thailand', flag: '\u{1F1F9}\u{1F1ED}', dialCode: '+66',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Thai ID Card', description: 'Thai citizen identity card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Thai Passport', description: 'Thai passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'ID', name: 'Indonesia', flag: '\u{1F1EE}\u{1F1E9}', dialCode: '+62',
    status: 'supported',
    idTypes: [
      { id: 'KTP', label: 'KTP (e-KTP)', description: 'Indonesian national ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Indonesian Passport', description: 'Indonesian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'BD', name: 'Bangladesh', flag: '\u{1F1E7}\u{1F1E9}', dialCode: '+880',
    status: 'supported',
    idTypes: [
      { id: 'NID', label: 'National ID Card', description: 'Bangladeshi national ID', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Bangladeshi Passport', description: 'Bangladeshi passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'CN', name: 'China', flag: '\u{1F1E8}\u{1F1F3}', dialCode: '+86',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Resident Identity Card', description: 'Chinese resident ID (身份证)', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Chinese Passport', description: 'Chinese passport (护照)', fields: ['identification_number'] },
    ],
  },

  // ─── Caribbean ───────────────────────────────────────────────────────────
  {
    code: 'JM', name: 'Jamaica', flag: '\u{1F1EF}\u{1F1F2}', dialCode: '+1-876',
    status: 'supported',
    idTypes: [
      { id: 'DRIVERS_LICENSE', label: "Driver's Licence", description: 'Jamaican driver\'s licence', fields: ['identification_number'] },
    ],
  },
  {
    code: 'TT', name: 'Trinidad and Tobago', flag: '\u{1F1F9}\u{1F1F9}', dialCode: '+1-868',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID Card', description: 'TT national ID', fields: ['identification_number'] },
      { id: 'DRIVERS_LICENSE', label: "Driver's Permit", description: "TT driver's permit", fields: ['identification_number'] },
    ],
  },

  // ─── Middle East ─────────────────────────────────────────────────────────
  {
    code: 'JO', name: 'Jordan', flag: '\u{1F1EF}\u{1F1F4}', dialCode: '+962',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'National ID', description: 'Jordanian national ID', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Jordanian Passport', description: 'Jordanian passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'KW', name: 'Kuwait', flag: '\u{1F1F0}\u{1F1FC}', dialCode: '+965',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Civil ID', description: 'Kuwaiti civil identity card', fields: ['identification_number'] },
    ],
  },
  {
    code: 'QA', name: 'Qatar', flag: '\u{1F1F6}\u{1F1E6}', dialCode: '+974',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'QID', description: 'Qatar ID card', fields: ['identification_number'] },
      { id: 'PASSPORT', label: 'Passport', description: 'Qatari or residence passport', fields: ['identification_number'] },
    ],
  },
  {
    code: 'OM', name: 'Oman', flag: '\u{1F1F4}\u{1F1F2}', dialCode: '+968',
    status: 'supported',
    idTypes: [
      { id: 'NATIONAL_ID', label: 'Civil ID', description: 'Omani civil ID card', fields: ['identification_number'] },
    ],
  },
  {
    code: 'BH', name: 'Bahrain', flag: '\u{1F1E7}\u{1F1ED}', dialCode: '+973',
    status: 'supported',
    idTypes: [
      { id: 'CPR', label: 'CPR Card', description: 'Bahraini Central Population Registry card', fields: ['identification_number'] },
    ],
  },
];

/**
 * Helper: get a country by code
 */
export function getKYCCountry(code: string): KYCCountry | undefined {
  return KYC_COUNTRIES.find(c => c.code === code);
}

/**
 * Helper: get supported countries only
 */
export function getSupportedCountries(): KYCCountry[] {
  return KYC_COUNTRIES.filter(c => c.status === 'supported');
}

/**
 * Helper: check if a country code is on Maplerad restricted list
 */
export function isRestricted(code: string): boolean {
  return MAPLERAD_RESTRICTED.includes(code);
}
