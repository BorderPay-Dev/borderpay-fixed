import { assertEquals } from 'jsr:@std/assert';
import { previewWalletAssets, PREVIEW_EEA_COUNTRIES } from '../utils/compliance/walletRegionPreview.ts';
import { ISO2_COUNTRIES, ISO3_TO_ISO2 } from '../supabase/functions/_shared/iso-country-codes.ts';
import { BRIDGE_EEA_SCA_COUNTRIES } from '../supabase/functions/_shared/bridge-sca-scope.ts';
import { friendlyError } from '../utils/errors/friendlyError.ts';

Deno.test('before approval, catalogue shows the two regional assets for ISO2 and ISO3 countries', () => {
  assertEquals([...PREVIEW_EEA_COUNTRIES].sort(), [...BRIDGE_EEA_SCA_COUNTRIES].sort());
  assertEquals(PREVIEW_EEA_COUNTRIES.size, 30);
  for (const country of ISO2_COUNTRIES) {
    assertEquals(previewWalletAssets(country), PREVIEW_EEA_COUNTRIES.has(country)
      ? ['USDC', 'EURC'] : ['USDC', 'USDT']);
  }
  for (const [iso3, iso2] of Object.entries(ISO3_TO_ISO2)) {
    assertEquals(previewWalletAssets(iso3), previewWalletAssets(iso2));
  }
  assertEquals(previewWalletAssets(' GBR '), ['USDC', 'USDT']);
  assertEquals(previewWalletAssets('LT'), ['USDC', 'EURC']);
  assertEquals(previewWalletAssets(null), []);
  assertEquals(previewWalletAssets('invalid'), []);
});
Deno.test('missing sending details does not mislabel an approved account as unverified', () => {
  const copy = 'We could not load this wallet’s sending details. Refresh your wallets and try again.';
  assertEquals(friendlyError('This wallet is not ready for sending yet. Please refresh and try again.'), copy);
  assertEquals(friendlyError(copy), copy);
  assertEquals(friendlyError('insufficient funds'), 'Insufficient balance for this transaction.');
  assertEquals(friendlyError('Identity verification required'), 'Identity verification required. Verify your ID to continue.');
});
