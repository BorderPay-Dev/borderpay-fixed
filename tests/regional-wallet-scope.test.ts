import { ISO3_TO_ISO2, ISO2_COUNTRIES } from '../supabase/functions/_shared/iso-country-codes.ts';
import { resolveBridgeWalletAssetScope, normalizeBridgeScaCountry, BRIDGE_EEA_SCA_COUNTRIES } from '../supabase/functions/_shared/bridge-sca-scope.ts';
import { bridgeProvider } from '../supabase/functions/_shared/providers/bridge.ts';
import { loadVirtualAccountDestinationConfig } from '../supabase/functions/_shared/providers/virtual-account-config.ts';
import { receivingAccountHolder, receivingAccountInstructions } from '../utils/financial/receivingAccountDetails.ts';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function database(accountType: string, country: string, approved = true, cacheError = false) {
  const writes: any[] = [];
  const db = { writes, from(table: string) {
    const filters: Record<string, unknown> = {};
    const query: any = {
      select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      ilike() { return query; }, or() { return query; }, order() { return query; },
      limit() { return query; },
      then(resolve: (value: unknown) => void) { resolve({ data: table === 'business_profiles' ? (accountType === 'business' ? [{ user_id: 'owner' }] : []) : [{ id: 'owner', account_type: accountType }] }); },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles'
        ? { id: 'owner', account_type: accountType, country: 'FR', bridge_customer_id: 'customer', bridge_kyc_status: approved ? 'approved' : 'incomplete' }
        : table === 'business_profiles' ? { user_id: 'owner', country, bridge_customer_id: 'customer', bridge_kyb_status: approved ? 'approved' : 'incomplete' }
        : table === 'bridge_wallets' ? { bridge_wallet_id: 'one-base-wallet', address: '0xbase', currency: 'USDC', chain: 'base', status: 'active' } : null, error: null }); },
      upsert(row: unknown) { writes.push({ table, row }); return Promise.resolve({ error: cacheError ? { message: 'unavailable' } : null }); },
    }; return query;
  }}; return db;
}
Deno.test('approved Kenya individual refreshes the RLS observation before exposing USDT; cache failure fails closed', async () => {
  const original = bridgeProvider.getCustomerProfile;
  bridgeProvider.getCustomerProfile = async (id: string) => {
    assert(id === 'customer', 'must use canonical customer');
    return { country: 'KE', raw: { residential_address: { country: 'KEN' } } } as any;
  };
  try {
    const db = database('individual', 'KE');
    const start = Date.now();
    const scope = await resolveBridgeWalletAssetScope(db, 'owner');
    assert(scope.allow_usdt_tron && !scope.allow_eurc_base, 'Kenya must expose USDT only');
    const observation = db.writes[0]?.row;
    assert(observation?.user_id === 'owner' && observation.bridge_customer_id === 'customer' && observation.provider_country === 'KE', 'persist provider-confirmed residence under same identity');
    assert(Date.parse(observation.checked_at) >= start && Date.parse(observation.expires_at) > Date.now(), 'replace expired observation before return');
    const failed = await resolveBridgeWalletAssetScope(database('individual', 'KE', true, true), 'owner');
    assert(failed.region === 'unknown' && !failed.allow_usdt_tron && !failed.allow_eurc_base, 'cache error cannot claim readable wallets');
  } finally { bridgeProvider.getCustomerProfile = original; }
});
Deno.test('business product scope uses incorporation without provider profile or wallet inventory', async () => {
  const original = bridgeProvider.getCustomerProfile, list = bridgeProvider.listWallets;
  bridgeProvider.getCustomerProfile = async () => { throw new Error('must not use contact/provider country'); };
  bridgeProvider.listWallets = async () => { throw new Error('missing wallet must not choose region'); };
  try {
    for (const country of ['FR', 'LV', 'GB', 'KE', 'ZZ']) {
      const db = database('business', country);
      const scope = await resolveBridgeWalletAssetScope(db, 'owner');
      assert(scope.allow_eurc_base === ['FR', 'LV'].includes(country), `${country} EURC`);
      assert(scope.allow_usdt_tron === ['GB', 'KE'].includes(country), `${country} USDT`);
      assert(db.writes.length === 0, 'business signup country is not a provider-country observation');
    }
    assert((await resolveBridgeWalletAssetScope(database('business', 'KE', false), 'owner')).region === 'unknown', 'unapproved wallet cannot be activated');
  } finally { bridgeProvider.getCustomerProfile = original; bridgeProvider.listWallets = list; }
});
Deno.test('all regional VA currencies use the same owned Base wallet and the correct asset', async () => {
  for (const country of ['FR', 'GB', 'KE']) for (const currency of ['EUR', 'USD', 'GBP'] as const) {
    const result = await loadVirtualAccountDestinationConfig(database('business', country), currency, { userId: 'owner', bridgeCustomerId: 'customer' });
    assert(result.bridge_wallet_id === 'one-base-wallet' && result.payment_rail === 'base', 'one owned Base resource');
    assert(result.currency === (country === 'FR' && currency === 'EUR' ? 'EURC' : 'USDC'), `${country} ${currency} settlement`);
  }
});
Deno.test('EUR named beneficiary and instructions remain distinct from GBP provider instructions', () => {
  const fields = { bank_beneficiary_name: 'Provider Ltd', account_holder_name: 'NOVELIA LIMITED' };
  assert(receivingAccountHolder('EUR', fields) === 'NOVELIA LIMITED', 'EUR merchant name');
  assert(receivingAccountHolder('GBP', fields) === 'Provider Ltd', 'GBP designated holder');
  assert(!receivingAccountInstructions('EUR').includes('provider'), 'EUR does not borrow GBP instructions');
  assert(receivingAccountInstructions('GBP').includes('reference'), 'GBP retains reference instruction');
});

Deno.test('all 249 ISO countries normalize; only the EEA-30 receive EURC eligibility', async () => {
  assert(ISO2_COUNTRIES.size === 249 && Object.keys(ISO3_TO_ISO2).length === 249, 'complete ISO country table');
  for (const [three, two] of Object.entries(ISO3_TO_ISO2)) {
    assert(normalizeBridgeScaCountry(three) === two && normalizeBridgeScaCountry(two) === two, `normalize ${two}/${three}`);
    const result = await resolveBridgeWalletAssetScope(database('business', three), 'owner');
    assert(result.allow_eurc_base === BRIDGE_EEA_SCA_COUNTRIES.has(two), `${two} EURC boundary`);
    assert(result.allow_usdt_tron === !BRIDGE_EEA_SCA_COUNTRIES.has(two), `${two} USDT boundary`);
  }
});
