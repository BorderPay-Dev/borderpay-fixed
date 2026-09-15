import { isValidCryptoAddress } from '../../utils/financial/cryptoAddress.ts';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('withdrawal validation accepts Tron and Base addresses and rejects wrong-network or malformed destinations', () => {
  const tron = 'T' + 'a'.repeat(33);
  const base = '0x' + 'a'.repeat(40);
  assert(isValidCryptoAddress('tron', tron), 'valid saved USDT/Tron address must be selectable');
  assert(isValidCryptoAddress('base', base), 'valid USDC/EURC Base address must be selectable');
  assert(!isValidCryptoAddress('tron', base) && !isValidCryptoAddress('base', tron), 'wrong-network addresses must be rejected');
  for (const invalid of ['', 'T' + '0'.repeat(33), tron.slice(1), tron + 'a']) assert(!isValidCryptoAddress('tron', invalid), 'invalid Tron address must be rejected');
  for (const invalid of ['', base.slice(1), base + 'a', '0x' + 'g'.repeat(40)]) assert(!isValidCryptoAddress('base', invalid), 'invalid Base address must be rejected');
});
