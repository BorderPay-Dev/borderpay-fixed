/**
 * Youverify SDK Document Type Mapping
 *
 * Maps BorderPay country+idType combinations to the document type values
 * accepted by the youverify-sdk documentCapture module.
 *
 * Valid SDK types: 'nin' | 'passport' | 'drivers-license' | 'pvc'
 * (from youverify-sdk source: allowedDocumentTypes)
 */

type YouverifyDocType = 'nin' | 'passport' | 'drivers-license' | 'pvc';

const DOC_TYPE_MAP: Record<string, Record<string, YouverifyDocType>> = {
  // Nigeria
  NG: {
    BVN: 'nin',
    NIN: 'nin',
    VNIN: 'nin',
    PASSPORT: 'passport',
    DRIVERS_LICENSE: 'drivers-license',
    PVC: 'pvc',
  },
  // Ghana
  GH: {
    SSNIT: 'nin',
    PASSPORT: 'passport',
    VOTERS_CARD: 'pvc',
    DRIVERS_LICENSE: 'drivers-license',
  },
  // Kenya
  KE: {
    NATIONAL_ID: 'nin',
    PASSPORT: 'passport',
    DRIVERS_LICENSE: 'drivers-license',
    ALIEN_ID: 'nin',
  },
  // South Africa
  ZA: {
    NATIONAL_ID: 'nin',
    PASSPORT: 'passport',
    DRIVERS_LICENSE: 'drivers-license',
  },
  // Cameroon
  CM: {
    NATIONAL_ID: 'nin',
    PASSPORT: 'passport',
  },
  // Côte d'Ivoire
  CI: {
    NATIONAL_ID: 'nin',
    PASSPORT: 'passport',
    DRIVERS_LICENSE: 'drivers-license',
  },
};

export function getYouverifyDocumentType(countryCode: string, idType: string): YouverifyDocType {
  return DOC_TYPE_MAP[countryCode]?.[idType] || 'nin';
}
