const base = 'https://scope-refresh.invalid';
const bridge = 'https://scope-provider.invalid';
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
Deno.env.set('BRIDGE_BASE_URL', bridge);
Deno.env.set('BRIDGE_API_KEY', 'test-provider');
type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/refresh-wallet-scopes/index.ts'); } finally { Deno.serve = serve; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('background refresh authenticates, fetches provider residence, preserves failed cache, and records retry', async () => {
 const original = globalThis.fetch;
 let providerStatus = 200;
 let country = 'KE', cacheWrites: any[] = [], jobWrites: any[] = [], claims = 0, providerReads = 0;
 globalThis.fetch = async (input, init) => {
  const req = new Request(input, init), url = new URL(req.url);
  if (url.origin === bridge) {
   providerReads++;
   assert(req.method === 'GET' && url.pathname === '/v0/customers/customer', 'Provider reads only; no wallets or payments');
   if (providerStatus !== 200) return Response.json({message:'sensitive-provider-details'}, {status:providerStatus});
   return Response.json({ id: 'customer', residential_address: { country } });
  }
  assert(url.origin === base, 'Unexpected network');
  if (url.pathname.endsWith('/rpc/claim_wallet_scope_refresh_batch')) {
   const auth = req.headers.get('Authorization');
   assert(req.headers.get('apikey') === 'test-service', 'Use configured project gateway key');
   if (auth === 'Bearer user-token') return Response.json({code:'42501'}, {status:403});
   if (auth === 'Bearer wrong-project-token') return Response.json({code:'PGRST301'}, {status:401});
   assert(auth === 'Bearer test-service' || auth === 'Bearer alternate-valid-service-jwt', 'Forward original caller credential');
   claims++; return Response.json([{ user_id: 'owner', lease_token: 'lease' }]);
  }
  if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: 'individual', country: 'GB', bridge_customer_id: 'customer', bridge_kyc_status: 'approved' }]);
  if (url.pathname.endsWith('/business_profiles')) return Response.json([]);
  if (url.pathname.endsWith('/sca_customer_scopes')) { cacheWrites.push(await req.json()); return Response.json({}); }
  if (url.pathname.endsWith('/wallet_scope_refresh_jobs')) {
   assert(url.searchParams.get('lease_token') === 'eq.lease', 'Stale worker must not release a newer lease');
   jobWrites.push(await req.json()); return Response.json({});
  }
  throw new Error('Unexpected request '+url.pathname);
 };
 const call = (token: string) => handler(new Request(base, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
 try {
  assert((await call('user-token')).status === 401 && claims === 0 && providerReads === 0, 'DB execute permission rejects app user before claims/provider reads');
  assert((await call('wrong-project-token')).status === 401 && claims === 0 && providerReads === 0, 'Project JWT rejection cannot fall back to privileged credentials');
  let result = await (await call('alternate-valid-service-jwt')).json();
  assert(result.refreshed === 1 && cacheWrites[0].provider_country === 'KE', 'Refresh actual provider country');
  assert(cacheWrites[0].sca_required === false, 'Non-EEA cache classification');
  assert(Date.parse(cacheWrites[0].expires_at) > Date.now(), 'New genuine observation has fresh expiry');
  country = 'FR'; await call('test-service');
  assert(cacheWrites[1].sca_required === true && cacheWrites[1].provider_country === 'FR', 'EEA refresh retains scope');
  country = ''; result = await (await call('test-service')).json();
  assert(result.failed === 1 && cacheWrites.length === 2, 'No fabricated cache on unresolved provider response');
  assert(jobWrites[2].last_error === 'authoritative_country_missing' && !jobWrites[2].last_success_at, 'Missing country distinguished from HTTP failure');
  assert(Date.parse(jobWrites[2].next_attempt_at) < Date.now()+6*60_000, 'Bounded retry delay');
  providerStatus = 404; result = await (await call('test-service')).json();
  assert(result.failed === 1 && jobWrites[3].last_error === 'bridge_http_404', 'Persist exact safe HTTP failure category');
  assert(cacheWrites.length === 2 && !JSON.stringify(jobWrites).includes('sensitive-provider-details'), 'Do not renew failed observations or store provider bodies');
 } finally { globalThis.fetch = original; }
});
