Deno.env.set('BRIDGE_API_KEY', 'test-only');
const { resolveBridgeWalletAssetScope, resolveBridgeScaScope } = await import('../supabase/functions/_shared/bridge-sca-scope.ts');
const { bridgeProvider } = await import('../supabase/functions/_shared/providers/bridge.ts');
const uid = 'owner';
function database(cache: any, businessCountry?: string) {
  let writes = 0;
  return { get writes() { return writes; }, from(table: string) {
    const query = {
      select(_value: string) { return query; }, eq(_key: string, _value: unknown) { return query; },
      gt(_key: string, _value: unknown) { return query; },
      maybeSingle() { return Promise.resolve({ error: null, data: table === 'sca_customer_scopes' ? cache
        : table === 'user_profiles' ? { id: uid, account_type: businessCountry ? 'business' : 'individual', country: 'FR', bridge_customer_id: 'customer', bridge_kyc_status: 'approved' }
        : { user_id: uid, country: businessCountry, bridge_customer_id: 'customer', bridge_kyb_status: 'approved' } }); },
      limit(_n: number) { return Promise.resolve({ error: null, data: table === 'business_profiles' ? businessCountry ? [{ user_id: uid }] : [] : [{ id: uid }] }); },
      upsert(_row: unknown, _options: unknown) { writes++; return Promise.resolve({ error: null }); },
    }; return query;
  }};
}
const fresh = () => ({ bridge_customer_id: 'customer', provider_country: 'KE', source: 'bridge_customer_api', checked_at: new Date(Date.now()-1000).toISOString(), expires_at: new Date(Date.now()+60000).toISOString() });
Deno.test('individual wallet visibility uses fresh matching provider observation without extra API calls or extending expiry', async () => {
  const original = bridgeProvider.getCustomerProfile;
  bridgeProvider.getCustomerProfile = () => { throw new Error('unexpected provider call'); };
  try {
    const db = database(fresh()); const scope = await resolveBridgeWalletAssetScope(db, uid);
    if (scope.region !== 'non_eea' || !scope.allow_usdt_tron || scope.allow_eurc_base || db.writes) throw new Error('fresh scope changed');
  } finally { bridgeProvider.getCustomerProfile = original; }
});
Deno.test('expired, future, mismatched and non-provider cache entries require a fresh provider observation', async () => {
  const original = bridgeProvider.getCustomerProfile; let reads = 0;
  bridgeProvider.getCustomerProfile = async () => { reads++; return { country: 'FR', raw: { residential_address: { country: 'FR' } } } as any; };
  try {
    for (const patch of [{ expires_at: new Date(0).toISOString() }, { checked_at: new Date(Date.now()+60000).toISOString() }, { bridge_customer_id: 'other' }, { source: 'untrusted' }, { provider_country: 'invalid' }]) {
      const db = database({ ...fresh(), ...patch }); const scope = await resolveBridgeWalletAssetScope(db, uid);
      if (scope.region !== 'eea' || scope.allow_usdt_tron || !scope.allow_eurc_base || db.writes !== 1) throw new Error('invalid cache accepted');
    }
    if (reads !== 5) throw new Error('provider not consulted');
  } finally { bridgeProvider.getCustomerProfile = original; }
});
Deno.test('refresh worker forces provider reads and payment SCA never uses the asset cache', async () => {
  const original = bridgeProvider.getCustomerProfile; let reads = 0;
  bridgeProvider.getCustomerProfile = async () => { reads++; return { country: 'FR', raw: { residential_address: { country: 'FR' } } } as any; };
  try {
    const db = database(fresh());
    await resolveBridgeWalletAssetScope(db, uid, { forceRefresh: true });
    const payment = await resolveBridgeScaScope(db, uid, 'payment');
    if (reads !== 2 || !payment.required) throw new Error('payment or refresh reused stale asset scope');
    const business = await resolveBridgeWalletAssetScope(database(fresh(), 'IT'), uid);
    if (business.region !== 'eea' || reads !== 2) throw new Error('business incorporation replaced by cache');
  } finally { bridgeProvider.getCustomerProfile = original; }
});
