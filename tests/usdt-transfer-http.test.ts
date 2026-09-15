// Real transfer handler and provider serializer; only HTTP transports are mocked.
const base = 'https://usdt-test.invalid';
const provider = 'https://usdt-bridge.invalid';
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', provider);
Deno.env.set('BRIDGE_API_KEY', 'test-only');
Deno.env.set('BRIDGE_TRANSFERS_ENABLED', 'true');
Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true');
type Handler = (request: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/bridge-transfer/index.ts'); } finally { Deno.serve = serve; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('non-EEA USDT/Tron payout persists provider transfer ID, replays once, rejects EEA and insufficient funds', async () => {
  const originalFetch = globalThis.fetch;
  const destination = `T${'a'.repeat(33)}`;
  let country = 'KE';
  let balance = 20000000;
  let prior: any = null;
  let saved = true;
  const sent: any[] = [];
  const persisted: any[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === provider) {
      if (request.method === 'GET' && url.pathname === '/v0/customers/customer/wallets') return Response.json({ data: [{ id: 'base-wallet', chain: 'base', currency: 'usdc', status: 'active' }] });
      assert(request.method === 'POST' && url.pathname === '/v0/transfers', 'only direct transfer endpoint is allowed');
      sent.push(await request.json());
      assert(request.headers.get('Idempotency-Key') === 'borderpay:transfer:owner:usdt-send-123', 'provider idempotency must be owner-bound');
      return Response.json({ id: 'bridge-transfer-123', state: 'payment_processed' });
    }
    assert(url.origin === base, 'unexpected external request');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: 'business', country: 'FR', account_status: 'active', bridge_customer_id: 'customer', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: 'owner', country, bridge_customer_id: 'customer', bridge_kyb_status: 'approved' }]);
    if (url.pathname.endsWith('/transactions')) return Response.json(prior ? [prior] : []);
    if (url.pathname.endsWith('/external_wallets')) return Response.json(saved ? [{ id: 'saved-1', address: destination, asset: 'USDT', chain: 'tron' }] : []);
    if (url.pathname.endsWith('/bridge_balance_ledger')) {
      assert(url.searchParams.get('currency') === 'eq.USDT', 'USDT payout must use only USDT balance');
      return Response.json([{ amount_minor: balance, direction: 'credit' }]);
    }
    if (url.pathname.endsWith('/rpc/upsert_bridge_transaction')) { persisted.push(await request.json()); return Response.json(null); }
    if (url.pathname.endsWith('/admin_alerts')) return new Response(null, { status: 201 });
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
  };
  const call = async () => {
    const response = await handler(new Request(`${base}/functions/v1/bridge-transfer`, { method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify({
      idempotency_key: 'usdt-send-123', source: { payment_rail: 'bridge_wallet', bridge_wallet_id: 'tron-wallet', currency: 'USDT', amount: '10' },
      destination: { payment_rail: 'tron', currency: 'USDT', address: destination, external_wallet_id: 'saved-1' },
    }) }));
    return { status: response.status, body: await response.json() };
  };
  try {
    for (country of ['KE', 'GB']) {
      const result = await call();
      assert(result.status === 200 && result.body.data.transfer_id === 'bridge-transfer-123', JSON.stringify(result));
      const payload = sent.at(-1);
      assert(payload.source.currency === 'usdt' && payload.source.bridge_wallet_id === 'tron-wallet', 'must spend selected Tron USDT');
      assert(payload.destination.payment_rail === 'tron' && payload.destination.to_address === destination, 'must pay saved Tron address directly');
      assert(!payload.developer_fee && !payload.initiation, 'same-token non-EEA payout must not invent fees or SCA evidence');
      assert(persisted.at(-1).p_bridge_transfer_id === 'bridge-transfer-123', 'provider ID must be recorded');
      assert(persisted.at(-1).p_metadata.sca_scope_reason === 'non_eea', 'must record actual jurisdiction decision');
    }
    prior = { bridge_transfer_id: 'bridge-transfer-123', status: 'completed' };
    assert((await call()).body.data.replayed === true, 'retry must reuse existing transfer');
    prior = null;
    balance = 1000000;
    assert((await call()).body.code === 'insufficient_balance', 'must reject insufficient USDT');
    balance = 20000000; saved = false;
    assert((await call()).body.code === 'saved_external_wallet_required', 'must reject unsaved destination');
    saved = true;
    for (country of ['FR', 'LV', 'IT', '']) {
      assert((await call()).body.code === 'wallet_asset_not_available', 'EEA/unknown must reject USDT');
    }
    assert(sent.length === 2 && persisted.length === 2, 'retries and rejections must not move funds');
  } finally { globalThis.fetch = originalFetch; }
});
