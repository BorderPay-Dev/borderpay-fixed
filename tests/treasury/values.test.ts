import { walletBalance, formatSortCode, isPending } from '../../components/business/treasury/values.ts';
import { virtualAccountRows } from '../../supabase/functions/bridge-operator-readonly/accounts.ts';
const equal = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); };
Deno.test('asset balances never sum different tokens on the same Base wallet', () => {
  const balances = [{currency:'USDC',chain:'base',balance:'42.50'}, {currency:'eurc',chain:'base',balance:'80'}];
  equal(walletBalance({currency:'EURC', chain:'base', balance_available:true, balances}),80);
  equal(walletBalance({currency:'USDC', chain:'base', balance_available:true, balances}),42.5);
});
Deno.test('missing, invalid and unavailable balances stay unknown; real zero stays zero', () => {
  const wallet = {currency:'USDC',chain:'base',balance_available:true,balances:[] as any[]};
  equal(walletBalance(wallet),null);
  equal(walletBalance({...wallet,balances:[{currency:'USDC',balance:'invalid'}]}),null);
  equal(walletBalance({...wallet,balances:[{currency:'USDC',balance:'0'}]}),0);
  equal(walletBalance({...wallet,balance_available:false,balances:[{currency:'USDC',balance:'9'}]}),null);
});
Deno.test('GBP sort code supports Bridge aliases, nesting and leading zeros', () => {
  for (const instructions of [{sort_code:'040075'}, {bank_sort_code:'04-00-75'}, {bank_account:{sort_code:'04 00 75'}}, {bank_routing_number:'040075'}]) {
    const account = virtualAccountRows({currency:'GBP',virtual_account_id:'va',account_details:{source_deposit_instructions:instructions}})[0];
    equal(formatSortCode(account.sort_code),'04-00-75');
  }
  equal(formatSortCode('123456789'),'');
  equal(formatSortCode(''),'');
});
Deno.test('multi-currency bank instructions keep US routing separate from GBP sort code', () => {
  const rows = virtualAccountRows({virtual_account_id:'va',account_details:{source_deposit_instructions:{USD:{bank_routing_number:'123456789'},GBP:{sort_code:'040075'},EUR:{iban:'TESTIBAN'}}}});
  equal(rows.find(x=>x.currency==='USD')?.routing_number,'123456789');
  equal(rows.find(x=>x.currency==='USD')?.sort_code,'');
  equal(rows.find(x=>x.currency==='GBP')?.sort_code,'040075');
  equal(rows.find(x=>x.currency==='EUR')?.iban,'TESTIBAN');
});
Deno.test('failed and refunded transfers do not inflate pending counts', () => {
  for (const state of ['failed','refunded','returned','completed','payment_processed','cancelled']) equal(isPending(state),false);
  equal(isPending('payment_submitted'),true);
});
