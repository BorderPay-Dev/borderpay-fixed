const base = 'https://external-account-list.invalid', bridge = 'https://external-account-bridge.invalid';
Deno.env.set('SUPABASE_URL', base); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', bridge); Deno.env.set('BRIDGE_API_KEY', 'test-only');
type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/bridge-external-account/index.ts'); } finally { Deno.serve = serve; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('partial external-account projection reconciles every provider page and keeps saved descriptors on failure', async () => {
  const original = globalThis.fetch;
  let failProvider = false, mirror: any[] = [{ bridge_external_account_id: 'existing-1', account_type: 'us', currency: 'USD' }];
  const pages: string[] = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.origin === bridge) {
      assert(req.method === 'GET' && url.pathname === '/v0/customers/customer/external_accounts', 'listing cannot create accounts or transfer funds');
      if (failProvider) return Response.json({ message: 'Unavailable' }, { status: 400 });
      pages.push(url.searchParams.get('starting_after') || '');
      return Response.json({ data: url.searchParams.has('starting_after')
        ? [{ id: 'saved-gb', account_type: 'gb', currency: 'gbp', account_owner_name: 'Business Ltd', status: 'active' }]
        : Array.from({ length: 100 }, (_, i) => ({ id: `saved-${i}`, account_type: 'iban', currency: 'eur', iban: { last_4: '1234' }, status: 'active' })) });
    }
    assert(url.origin === base, 'unexpected network');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: 'business', country: 'GB', bridge_customer_id: 'customer', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: 'owner', country: 'FR', bridge_customer_id: 'customer', bridge_kyb_status: 'approved' }]);
    if (url.pathname.endsWith('/bridge_external_accounts')) {
      if (req.method === 'GET') { assert(url.searchParams.get('user_id') === 'eq.owner', 'projection must be owner scoped'); return Response.json(mirror); }
      mirror = await req.json();
      assert(mirror.length === 101 && mirror.every(row => row.user_id === 'owner'), 'reconcile complete owned descriptor list');
      assert(!JSON.stringify(mirror).includes('account_number'), 'never project bank account numbers');
      return Response.json(mirror);
    }
    throw new Error(`Unexpected ${req.method} ${url.pathname}`);
  };
  const call = (action: string) => handler(new Request(`${base}/functions/v1/test`, { method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }));
  try {
    const response = await call('list'), data = await response.json();
    assert(response.status === 200 && data.data.external_accounts.length === 101, 'a nonempty partial projection must not hide other saved accounts');
    assert(pages.join(',') === ',saved-99', 'follow pagination');
    assert(data.data.external_accounts[100].account_type === 'gb', 'UK account normalized');
    failProvider = true;
    const fallback = await (await call('list')).json();
    assert(fallback.data.partial && fallback.data.external_accounts.length === 101, 'preserve projection on provider failure');
    const caps = await (await call('capabilities')).json();
    assert(caps.data.supported_account_types.join(',') === 'us,iban,gb', 'all three fiat account forms available');
  } finally { globalThis.fetch = original; }
});
