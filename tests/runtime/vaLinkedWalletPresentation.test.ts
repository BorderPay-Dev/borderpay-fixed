import assert from 'node:assert/strict';
import { selectVaLinkedStablecoinWallets } from '../../utils/financial/vaLinkedWalletPresentation.ts';

const canonicalId = '81324bfd-6d27-4460-9bd8-3024737e4441';
const duplicateId = '1bd6a097-12a9-4e31-bb5f-150734564476';
const wallets = [
  { id: 'local-usdc', bridge_wallet_id: duplicateId, currency: 'USDC', chain: 'base', address: '0xduplicate', status: 'active' },
  { id: 'local-eurc', bridge_wallet_id: canonicalId, currency: 'EURC', chain: 'base', address: '0xcanonical', status: 'active' },
  { id: 'local-usdt', bridge_wallet_id: 'tron-wallet', currency: 'USDT', chain: 'tron', address: 'T123', status: 'active' },
];
const virtualAccounts = [
  { currency: 'USD', status: 'active', account_details: { destination: { bridge_wallet_id: canonicalId, currency: 'USDC', payment_rail: 'base' } } },
  { currency: 'EUR', status: 'active', account_details: { destination: { bridge_wallet_id: canonicalId, currency: 'EURC', payment_rail: 'base' } } },
  { currency: 'GBP', status: 'active', account_details: { destination: { bridge_wallet_id: canonicalId, currency: 'USDC', payment_rail: 'base' } } },
];

const selected = selectVaLinkedStablecoinWallets(wallets, virtualAccounts);
assert.deepEqual(selected.map((row) => row.currency), ['USDC', 'EURC', 'USDT']);
assert.equal(selected.some((row) => row.bridge_wallet_id === duplicateId), false);
assert.equal(selected.filter((row) => row.chain === 'base').every((row) => row.bridge_wallet_id === canonicalId), true);
assert.equal(selected.find((row) => row.currency === 'USDC')?.address, '0xcanonical');
assert.equal(selected.find((row) => row.currency === 'EURC')?.address, '0xcanonical');

const nonEea = selectVaLinkedStablecoinWallets(wallets, [
  { currency: 'USD', status: 'active', account_details: { destination: { bridge_wallet_id: duplicateId, currency: 'USDC', payment_rail: 'base' } } },
]);
assert.deepEqual(nonEea, wallets);

const ambiguous = selectVaLinkedStablecoinWallets(wallets, [
  ...virtualAccounts,
  { currency: 'EUR', status: 'active', account_details: { destination: { bridge_wallet_id: duplicateId, currency: 'EURC', payment_rail: 'base' } } },
]);
assert.deepEqual(ambiguous, wallets);

const inactive = selectVaLinkedStablecoinWallets(wallets, virtualAccounts.map((row) => ({ ...row, status: 'closed' })));
assert.deepEqual(inactive, wallets);

console.log('PASS: VA-linked Base wallet runtime fixtures');
