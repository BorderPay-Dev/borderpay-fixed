import { isNativeRuntime } from './native/mobileRuntime';

const AFRICAN_RAILS_TEST_EMAILS = new Set([
  'appreview.individual@borderpayafrica.com',
  'appreview.business@borderpayafrica.com',
  'adhiamboadhiambo22@gmail.com',
]);

const AFRICAN_RAILS_TEST_USER_IDS = new Set([
  '5a1a6473-ba4f-413d-8e1b-4464baf1e395',
  '8b2feb9a-6503-421b-bf70-0c23d1aa85b0',
]);

export function canUseAfricanRails(input?: { id?: string | null; email?: string | null } | null): boolean {
  // Keep YC/FLW African rails in browser/PWA review only until partner
  // configuration is fully signed off. Native App Store / Play builds must not
  // expose this incomplete flow.
  if (isNativeRuntime()) return false;

  const id = String(input?.id || '').trim().toLowerCase();
  const email = String(input?.email || '').trim().toLowerCase();
  return Boolean(
    (id && AFRICAN_RAILS_TEST_USER_IDS.has(id)) ||
    (email && AFRICAN_RAILS_TEST_EMAILS.has(email)),
  );
}
