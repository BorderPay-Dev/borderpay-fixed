const base = 'https://regional-provision.invalid';
const bridge = 'https://regional-bridge.invalid';
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', bridge);
Deno.env.set('BRIDGE_API_KEY', 'test-only');
type Handler = (request: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/bridge-provision-stablecoins/index.ts'); }
finally { Deno.serve = serve; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('approval provisioning reuses provider Base, creates only missing non-EEA Tron, and never writes balances', async () => {
  const original = globalThis.fetch;
  let country = 'FR', accountType = 'business', approved = true;
  let providerWallets: any[] = [], mirrors: any[] = [], created: any[] = [], cache: any;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.origin === bridge) {
      if (url.pathname === '/v0/customers/customer') return Response.json({ id: 'customer', residential_address: { country } });
      assert(url.pathname === '/v0/customers/customer/wallets', 'only owned wallet inventory/creation is allowed');
      if (req.method === 'GET') return Response.json({ data: providerWallets });
      const row = await req.json();
      assert(row.currency === undefined, 'Bridge wallets are chain-level');
      assert(!providerWallets.some(w => w.chain === row.chain), 'must never duplicate a chain');
      assert(req.headers.get('Idempotency-Key') === `borderpay:wallet:customer:${row.chain.toUpperCase()}`, 'stable chain-level idempotency');
      created.push(row);
      const wallet = { id: `${row.chain}-wallet`, chain: row.chain, address: row.chain === 'base' ? '0xbase' : 'Ttron', status: 'active' };
      providerWallets.push(wallet); return Response.json(wallet);
    }
    assert(url.origin === base, 'unexpected network');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: accountType, country: 'FR', bridge_customer_id: 'customer', bridge_kyc_status: approved ? 'approved' : 'incomplete' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json(accountType === 'business' ? [{ user_id: 'owner', country, bridge_customer_id: 'customer', bridge_kyb_status: approved ? 'approved' : 'incomplete' }] : []);
    if (url.pathname.endsWith('/sca_customer_scopes')) { cache = await req.json(); return Response.json(cache); }
    if (url.pathname.endsWith('/bridge_wallets')) {
      if (req.method === 'GET') return Response.json(mirrors.filter(row => [...url.searchParams].every(([key, value]) => {
        if (value.startsWith('eq.')) return row[key] === value.slice(3);
        if (value.startsWith('ilike.')) return row[key].toLowerCase() === value.slice(6).toLowerCase();
        return true;
      })));
      const row = await req.json();
      assert(!('balance' in row), 'reconciliation must never reset a balance');
      mirrors = [...mirrors.filter(w => w.bridge_wallet_id !== row.bridge_wallet_id), row];
      return Response.json(row);
    }
    throw new Error(`Unexpected database write/read ${req.method} ${url.pathname}`);
  };
  const call = async () => {
    const response = await handler(new Request(`${base}/functions/v1/bridge-provision-stablecoins`, { method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: '{}' }));
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const scenario of [{ country: 'FR', type: 'business' }, { country: 'GB', type: 'business' }, { country: 'KE', type: 'individual' }]) {
      country = scenario.country; accountType = scenario.type;
      providerWallets = [{ id: 'existing-base', chain: 'base', currency: 'USDC', address: '0xbase', status: 'active' }];
      mirrors = []; created = [];
      const first = await call();
      assert(first.status === 200, JSON.stringify(first));
      assert(first.body.data.wallets.map((w: any) => w.symbol).join(',') === (country === 'FR' ? 'USDC,EURC' : 'USDC,USDT'), 'regional assets');
      assert(created.length === (country === 'FR' ? 0 : 1), 'reuse Base and only provision missing Tron');
      assert(mirrors.some(w => w.bridge_wallet_id === 'existing-base'), 'restore missing provider mirror');
      const count = created.length;
      await call();
      assert(created.length === count, 'repeated activation is idempotent');
      if (accountType === 'individual') assert(cache.provider_country === 'KE', 'publish verified Kenya residence');
    }
    approved = false; created = []; mirrors = []; providerWallets = [];
    await call();
    assert(created.length === 0 && mirrors.length === 0, 'no provisioning before approval');
  } finally { globalThis.fetch = original; }
});
