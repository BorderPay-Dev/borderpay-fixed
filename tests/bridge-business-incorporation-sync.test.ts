import { syncBridgeCustomerIdentity } from '../supabase/functions/_shared/bridge-customer-identity-sync.ts';
import { resolveBridgeScaScope, BRIDGE_EEA_SCA_COUNTRIES } from '../supabase/functions/_shared/bridge-sca-scope.ts';
import { ISO2_COUNTRIES } from '../supabase/functions/_shared/iso-country-codes.ts';

function fixture(country = 'PL', raw: any = { registered_address: { country: 'GBR' }, residential_address: { country: 'POL' } }) {
  const rows: Record<string, any[]> = {
    user_profiles: [{ id: 'owner', account_type: 'business', country: 'PL', bridge_customer_id: 'customer', date_of_birth: '1990-01-01', id_number: 'test', id_type: 'test' }],
    business_profiles: [{ user_id: 'owner', country, bridge_customer_id: 'customer', bridge_kyb_status: 'approved', bridge_identity_metadata: { existing: true } }],
  };
  let reads = 0;
  const db = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let patch: any; let single = false;
    const execute = () => { const matches = rows[table].filter(r => filters.every(([k,v]) => r[k] === v)); if (patch) matches.forEach(r => Object.assign(r, patch)); return { data: single ? matches[0] ?? null : matches, error: null }; };
    const builder: any = { select(){return builder;}, eq(k: string,v: unknown){filters.push([k,v]);return builder;}, is(k: string,v: unknown){filters.push([k,v]);return builder;}, limit(){return builder;}, update(v: unknown){patch=v;return builder;}, maybeSingle(){single=true;return Promise.resolve(execute());}, then(a: any,b: any){return Promise.resolve(execute()).then(a,b);} }; return builder;
  } };
  const provider: any = { getCustomerProfile: async () => { reads++; return { raw, country: 'PL', address_object: {}, identity_metadata: {} }; } };
  return { db, rows, provider, reads: () => reads };
}
const owner = { resolved: 'owner', account_type: 'business' as const };
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }

Deno.test('approved existing UK business replaces old EEA contact country before payout classification', async () => {
  const f=fixture(); await syncBridgeCustomerIdentity(f.db,f.provider,'customer',owner);
  assert(f.reads()===1,'populated identity must not skip provider reconciliation');
  assert(f.rows.business_profiles[0].country==='GB','registered UK country persisted');
  assert(f.rows.user_profiles[0].country==='PL','contact country stays separate');
  assert(f.rows.business_profiles[0].bridge_identity_metadata.existing,'existing metadata retained');
  const scope=await resolveBridgeScaScope(f.db,'owner','payment');
  assert(scope.status==='not_required' && scope.reason==='non_eea','UK payout must not require EEA SCA');
});
Deno.test('future approved business gets legal incorporation before its first payout', async () => {
  const f=fixture('',{country_of_incorporation:'USA',operating_address:{country:'FRA'}});
  await syncBridgeCustomerIdentity(f.db,f.provider,'customer',owner);
  assert(f.rows.business_profiles[0].country==='US','US incorporation must override French operations');
  assert(!(await resolveBridgeScaScope(f.db,'owner','payment')).required,'US business is non-EEA');
});
Deno.test('EEA incorporation overrides non-EEA contact country and still requires SCA', async () => {
  const f=fixture('GB',{country_of_incorporation:'FRA',registered_address:{country:'FRA'},operating_address:{country:'GBR'}});
  await syncBridgeCustomerIdentity(f.db,f.provider,'customer',owner);
  assert((await resolveBridgeScaScope(f.db,'owner','payment')).required,'French business must require SCA');
});
Deno.test('generic customer and operating countries never fill missing business incorporation', async () => {
  const f=fixture('',{country:'GBR',operating_address:{country:'GBR'},residential_address:{country:'POL'}});
  await syncBridgeCustomerIdentity(f.db,f.provider,'customer',owner);
  assert(f.rows.business_profiles[0].country==='','must not infer legal jurisdiction');
  assert((await resolveBridgeScaScope(f.db,'owner','payment')).status==='unknown','unknown jurisdiction blocks rather than exempts');
});
Deno.test('provider failure propagates so approval sync can retry', async () => {
  const f=fixture(); f.provider.getCustomerProfile=()=>Promise.reject(new Error('unavailable'));
  let failed=false;try{await syncBridgeCustomerIdentity(f.db,f.provider,'customer',owner);}catch{failed=true;}
  assert(failed,'sync must not silently retain a potentially wrong jurisdiction');
  assert(f.rows.business_profiles[0].country==='PL','no country change on failed provider read');
});
Deno.test('customer remapping cannot write another identity country', async () => {
  const f=fixture();let failed=false;try{await syncBridgeCustomerIdentity(f.db,f.provider,'other-customer',owner);}catch{failed=true;}
  assert(failed && f.rows.business_profiles[0].country==='PL','mismatched mapping must fail');
});
Deno.test('all ISO countries use exactly the EEA-30 boundary for business payments', async () => {
  assert(BRIDGE_EEA_SCA_COUNTRIES.size===30,'exactly 30 EEA countries');
  for(const country of ISO2_COUNTRIES){
    const f=fixture(country);const scope=await resolveBridgeScaScope(f.db,'owner','payment');
    assert(scope.required===BRIDGE_EEA_SCA_COUNTRIES.has(country),`wrong payment scope: ${country}`);
    assert(scope.status!=='unknown',`known country unresolved: ${country}`);
  }
});

Deno.test('initial KYB mapping on user profile can reconcile incorporation before business linking', async () => {
  const f=fixture('PL');f.rows.business_profiles[0].bridge_customer_id=null;
  await syncBridgeCustomerIdentity(f.db,f.provider,'customer',owner);
  assert(f.rows.business_profiles[0].country==='GB','first approval must reconcile legal country');
});
