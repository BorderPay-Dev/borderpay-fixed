const AFRICAN_RAILS_TEST_EMAILS = new Set([
  'adhiamboadhiambo22@gmail.com',
  'appreview.individual@borderpayafrica.com',
  'appreview.business@borderpayafrica.com',
]);

export function canUseAfricanRails(input?: { id?: string | null; email?: string | null } | null): boolean {
  const email = String(input?.email || '').trim().toLowerCase();
  return Boolean(email && AFRICAN_RAILS_TEST_EMAILS.has(email));
}
