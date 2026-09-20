import { assert, assertEquals } from 'jsr:@std/assert';
import { renderTemplate } from '../supabase/functions/_shared/email-templates/index.ts';
import { APP_STORE_URL, GOOGLE_PLAY_URL } from '../supabase/functions/_shared/email-templates/mobile-app-update.ts';

for (const audience of ['individual', 'business'] as const) {
 for (const template of ['mobile_app_update', 'app_store_announcement'] as const) {
  Deno.test(`${audience} ${template}: current approved builds and both store links`, () => {
   const email = renderTemplate(`${audience}.${template}`, { full_name: 'Alex Example', company_name: 'Example Ltd' });
   assertEquals(email.subject, 'Your BorderPay 1.0.10 update');
   for (const body of [email.html, email.text]) {
    assert(body.includes(APP_STORE_URL)); assert(body.includes(GOOGLE_PLAY_URL));
    assert(body.includes('1.0.10 (build 73)')); assert(body.includes('1.0.10 (build 77)'));
    assert(!body.includes('1.0.8')); assert(!body.includes('coming soon')); assert(!body.includes('under Apple review'));
    assert(body.includes('Check the App Store for availability'));
    assertEquals(body.includes('Create and download business invoices'), audience === 'business');
   }
  });
 }
}
Deno.test('public iOS availability remains an explicit confirmation', () => {
 const available=renderTemplate('individual.mobile_app_update',{ios_available:true});
 assert(available.text.includes('is available on the App Store'));
 const unconfirmed=renderTemplate('business.mobile_app_update',{ios_available:'true'});
 assert(!unconfirmed.text.includes('is available on the App Store'));
});
