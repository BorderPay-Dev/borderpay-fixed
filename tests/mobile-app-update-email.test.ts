import { assert, assertEquals } from 'jsr:@std/assert';
import { renderTemplate } from '../supabase/functions/_shared/email-templates/index.ts';
import { APP_STORE_URL, GOOGLE_PLAY_URL } from '../supabase/functions/_shared/email-templates/mobile-app-update.ts';

for (const audience of ['individual', 'business'] as const) {
  Deno.test(`${audience}: app-update email includes both stores and defaults to iOS under review`, () => {
    const email = renderTemplate(`${audience}.mobile_app_update`, { full_name: 'Alex Example' });
    assertEquals(email.subject, 'BorderPay 1.0.8: Android update available');
    for (const body of [email.html, email.text]) {
      assert(body.includes(APP_STORE_URL));
      assert(body.includes(GOOGLE_PLAY_URL));
      assert(body.includes('still under Apple review'));
      assert(!body.includes('iPhone: version 1.0.8 is available now'));
    }
  });
}
Deno.test('public iOS announcement requires explicit boolean confirmation', () => {
  const email = renderTemplate('individual.mobile_app_update', { ios_available: true });
  assert(email.html.includes('iPhone: version 1.0.8 is available now'));
  assert(email.text.includes('iPhone: version 1.0.8 is available now'));
  assert(!email.text.includes('under Apple review'));
  const unconfirmed = renderTemplate('business.mobile_app_update', { ios_available: 'true' });
  assert(unconfirmed.text.includes('still under Apple review'));
});
