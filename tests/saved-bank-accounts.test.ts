import { reconcileSavedBankAccounts } from '../utils/financial/savedBankAccounts.ts';
const saved: Array<{ bridge_external_account_id: string; type: string; name?: string }> = ['us', 'iban', 'gb'].map(type => ({ bridge_external_account_id: type, type }));
Deno.test('timeout cannot erase saved US, EUR IBAN or UK bank destinations', () => {
  const result = reconcileSavedBankAccounts(saved, [], false);
  if (JSON.stringify(result) !== JSON.stringify(saved)) throw new Error('failed refresh erased accounts');
});
Deno.test('partial bank projection merges known accounts without deleting other rails', () => {
  const result = reconcileSavedBankAccounts(saved, [{ bridge_external_account_id: 'iban', type: 'iban', name: 'updated' }], false);
  if (result.length !== 3 || (result[1] as any).name !== 'updated') throw new Error('partial refresh lost accounts');
});
Deno.test('confirmed empty provider list removes stale saved bank destinations', () => {
  if (reconcileSavedBankAccounts(saved, [], true).length) throw new Error('confirmed removal not reflected');
});
