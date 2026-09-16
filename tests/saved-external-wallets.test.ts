import { assertEquals } from 'jsr:@std/assert';
import { retainSavedExternalWallets } from '../utils/financial/savedExternalWallets.ts';
Deno.test('saved USDT survives cache hydration and refresh before regional scope is known', () => {
  const saved = [
    { id: 'saved-usdc', asset: 'USDC', chain: 'base', address: 'usdc-address' },
    { id: 'saved-usdt', asset: 'usdt', chain: ' TRON ', address: 'tron-address', bridge_payment_route_status: 'inactive' },
    { id: 'saved-eurc', asset: 'EURC', chain: 'base', address: 'eurc-address' },
  ];
  const initial = retainSavedExternalWallets<typeof saved[number]>(JSON.parse(JSON.stringify(saved)));
  // The visible list may be narrow while scope loads; persisted records are not.
  assertEquals(initial.filter(w => w.asset === 'USDC').length, 1);
  const refreshed = retainSavedExternalWallets<typeof saved[number]>(JSON.parse(JSON.stringify(initial)));
  assertEquals(refreshed.map(w => w.id), ['saved-usdc', 'saved-usdt', 'saved-eurc']);
  assertEquals(refreshed.find(w => w.asset === 'USDT')?.address, 'tron-address');
  assertEquals(retainSavedExternalWallets([null, { asset: 'USDT', chain: 'base' }, { asset: 'BTC', chain: 'bitcoin' }]), []);
});
