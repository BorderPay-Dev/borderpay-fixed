// Actual save/list handler against a mocked database transport. No live writes.
const base = 'https://external-wallet-test.invalid';
const uid = '5f24baca-00be-4a15-a635-3e368d978c17';
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler;
const realServe = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/external-wallet/index.ts'); }
finally { Deno.serve = realServe; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const address = `0x${'a'.repeat(40)}`;
const source = { user_id: uid, business_user_id: null, bridge_wallet_id: 'base-wallet', currency: 'USDC', chain: 'base', status: 'active', address: `0x${'b'.repeat(40)}`, updated_at: '2026-09-15' };
const destination = { action: 'add', label: 'EURC destination', asset: 'EURC', chain: 'base', address };
const call = (body: unknown) => handler(new Request(`${base}/functions/v1/external-wallet`, {
  method: 'POST', headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

Deno.test('EURC save/list accepts a USDC-labelled Base wallet for EEA and non-EEA without creating a Bridge transfer or liquidation route', async () => {
  const originalFetch = globalThis.fetch;
  let country = 'LV';
  let status = 'approved';
  let frozen = false;
  let expectedAsset = 'EURC';
  let rows: any[] = [source];
  const saved: any[] = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    assert(url.origin === base, 'saving a destination must not call Bridge or another provider');
    const response = (data: unknown) => Response.json(data);
    if (url.pathname === '/auth/v1/user') return response({ id: uid });
    if (url.pathname.endsWith('/user_profiles')) return response([{ id: uid, account_type: 'business', country: 'GB', account_status: frozen ? 'frozen' : 'active', bridge_customer_id: 'customer-1', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return response([{ user_id: uid, country, bridge_customer_id: 'customer-1', bridge_kyb_status: status }]);
    if (url.pathname.endsWith('/bridge_wallets')) {
      assert(url.searchParams.has('user_id') || url.searchParams.has('business_user_id'), 'source query must be owned');
      return response(rows.filter(row => [...url.searchParams].every(([key, filter]) => {
        if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3);
        if (filter.startsWith('ilike.')) return String(row[key]).toLowerCase() === filter.slice(6).toLowerCase();
        return true;
      })));
    }
    if (url.pathname.endsWith('/external_wallets')) {
      if (req.method === 'POST') {
        const body = await req.json();
        assert(body.user_id === uid && body.asset === expectedAsset && body.chain === (expectedAsset === 'USDT' ? 'tron' : 'base'), 'saved route must retain owner and requested asset');
        assert(!body.bridge_payment_route_id, 'must not persist an invented provider route ID');
        const row = { ...body, id: 'saved-1' }; saved.push(row); return response([row]);
      }
      return response(saved.slice(-1));
    }
    throw new Error(`Unexpected request ${req.method} ${url.pathname}`);
  };
  try {
    for (country of ['LV', 'GB']) {
      const result = await call(destination);
      const data = await result.json();
      assert(result.status === 200 && data.data.wallet.asset === 'EURC', `EURC save failed for ${country}: ${JSON.stringify(data)}`);
      const listed = await (await call({ action: 'list' })).json();
      assert(listed.data.wallets[0].asset === 'EURC', 'EURC must remain visible after saving');
    }
    rows = [{ ...source, user_id: null, business_user_id: uid }];
    assert((await call(destination)).status === 200, 'business-owned Base wallet must support EURC');
    const savedCount = saved.length;
    for (const invalid of [
      { ...source, user_id: 'someone-else' }, { ...source, chain: 'tron' },
      { ...source, currency: 'USDT' }, { ...source, status: 'closed' },
    ]) {
      rows = [invalid];
      assert((await call(destination)).status === 409, 'invalid source must not authorize saving');
    }
    rows = [source];
    status = 'incomplete';
    assert((await call(destination)).status === 409, 'unverified business must be blocked');
    status = 'approved'; frozen = true;
    assert((await call(destination)).status === 423, 'frozen customer must be blocked');
    assert(saved.length === savedCount, 'rejected requests must not change saved destinations');
    frozen = false; expectedAsset = 'USDT';
    const tronAddress = `T${'a'.repeat(33)}`;
    rows = [{ ...source, currency: 'USDT', chain: 'tron', address: tronAddress }];
    for (country of ['GB', 'KE']) {
      const result = await call({ ...destination, asset: 'USDT', chain: 'tron', address: tronAddress });
      assert(result.status === 200, 'non-EEA must be able to save USDT/Tron destinations');
      const listed = await (await call({ action: 'list' })).json();
      assert(listed.data.wallets[0].asset === 'USDT', 'non-EEA saved USDT destination must remain visible');
    }
  } finally { globalThis.fetch = originalFetch; }
});
