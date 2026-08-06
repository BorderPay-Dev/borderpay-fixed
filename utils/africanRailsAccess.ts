import { isNativeRuntime } from './native/mobileRuntime';

const AFRICAN_RAILS_TEST_EMAILS = new Set([
  'adhiamboadhiambo22@gmail.com',
  'appreview.individual@borderpayafrica.com',
  'appreview.business@borderpayafrica.com',
]);

export function canUseAfricanRails(input?: { id?: string | null; email?: string | null } | null): boolean {
  // Keep African rails in browser/PWA review only until partner
  // configuration is fully signed off. Native App Store / Play builds must not
  // expose this incomplete flow.
  if (isNativeRuntime()) return false;

  const email = String(input?.email || '').trim().toLowerCase();
  return Boolean(email && AFRICAN_RAILS_TEST_EMAILS.has(email));
}
