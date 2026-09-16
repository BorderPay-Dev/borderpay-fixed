import { hostedTermsAcceptance } from '../utils/verification/hostedTerms.ts';

Deno.test('business terms confirmation unlocks verification', () => {
  if (hostedTermsAcceptance({ success: true, data: { tos_accepted: true } }) !== true) throw new Error('acceptance not recognized');
});
Deno.test('individual identity link after terms unlocks verification', () => {
  if (hostedTermsAcceptance({ success: true, data: { link_url: 'https://verify.example/identity', tos_link_url: null } }) !== true) throw new Error('individual acceptance not recognized');
});
Deno.test('terms still required takes precedence over an identity link', () => {
  if (hostedTermsAcceptance({ success: true, data: { link_url: 'https://verify.example/identity', tos_link_url: 'https://verify.example/terms' } }) !== false) throw new Error('terms skipped');
});
Deno.test('failed and incomplete responses cannot confirm terms', () => {
  for (const result of [null, { success: false, data: { tos_accepted: true } }, { success: true, data: {} }]) {
    if (hostedTermsAcceptance(result) !== null) throw new Error('unconfirmed state changed');
  }
});
