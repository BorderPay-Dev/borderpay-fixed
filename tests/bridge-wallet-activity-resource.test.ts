// Exercise the actual webhook handler. Activity events must never mutate wallet
// descriptors, including during retries or when activity currency differs.
Deno.env.set('SUPABASE_URL', 'https://wallet-activity-db.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('SEND_EMAIL_INTERNAL_TOKEN', '');
const serve = Deno.serve;
Deno.serve = (() => ({})) as unknown as typeof Deno.serve;
let handleBridgeWallet: typeof import('../supabase/functions/process-pending-events/index.ts').handleBridgeWallet;
try { ({ handleBridgeWallet } = await import('../supabase/functions/process-pending-events/index.ts')); }
finally { Deno.serve = serve; }
const owner = '00000000-0000-4000-8000-000000000001';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function exercise(eventType: string, payload: Record<string, unknown>, failWrite = false) {
  const originalFetch = globalThis.fetch;
  const writes: Array<{ path: string; body: any; query: string }> = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init); const url = new URL(req.url);
    assert(url.origin === 'https://wallet-activity-db.invalid', 'webhook must not move money at a provider');
    if (req.method !== 'GET') {
      const body = await req.json(); writes.push({ path: url.pathname, body, query: url.search });
      if (failWrite && url.pathname.endsWith('/bridge_wallets')) return Response.json({ message: 'write failed' }, { status: 400 });
      return url.pathname.includes('/rpc/') ? Response.json(null) : new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/bridge_wallets')) return Response.json([{ bridge_customer_id: 'customer', user_id: owner, business_user_id: owner }]);
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: owner, account_type: 'business' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: owner }]);
    throw new Error(`Unexpected read ${url.pathname}`);
  };
  let error: string | null = null;
  try { await handleBridgeWallet({ source: 'bridge', event_id: 'bridge:wh-fixture', event_type: eventType,
    payload: { event_object: { wallet_id: 'wallet', ...payload } } } as any); }
  catch (e) { error = e instanceof Error ? e.message : String(e); }
  finally { globalThis.fetch = originalFetch; }
  return { writes, error };
}
Deno.test('deposits, withdrawals and refunds preserve wallet resource fields and still project the ledger', async () => {
  for (const payload of [
    { type: 'payment', amount: '-15', currency: 'usdc' },
    { type: 'payment', amount: '14.83', currency: 'usdc' },
    { type: 'payment', amount: '25', currency: 'usdt' },
    { type: 'payment', amount: '-8500', currency: 'eurc' },
  ]) {
    // No customer field: resolve canonical ownership from the existing wallet.
    const result = await exercise('wallet.activity.created', payload);
    assert(!result.error, String(result.error));
    assert(!result.writes.some(w => /\/(bridge_wallets|api_tenant_resources)$/.test(w.path)), 'activity overwrote custodial wallet descriptors');
    const ledger = result.writes.find(w => w.path.endsWith('/bridge_balance_ledger'));
    assert(ledger, 'movement was not projected');
    assert(ledger.body.currency === payload.currency.toUpperCase(), 'ledger lost moved token');
    assert(ledger.body.direction === (Number(payload.amount) < 0 ? 'debit' : 'credit'), 'ledger direction changed');
    assert(ledger.body.user_id === null && ledger.body.business_user_id === owner, 'legacy dual-owner mirror must resolve business ownership');
    assert(ledger.query.includes('on_conflict=event_id'), 'ledger retry must remain idempotent');
    assert(result.writes.some(w => w.path.endsWith('/complete_pending_event')), 'activity not completed');
  }
});
Deno.test('wallet lifecycle persists real Tron descriptors with uppercase asset', async () => {
  const result = await exercise('wallet.created', { customer_id: 'customer', currency: 'usdt', chain: 'tron', address: 'Tresource', status: 'active' });
  assert(!result.error, String(result.error));
  const wallet = result.writes.find(w => w.path.endsWith('/bridge_wallets'))?.body;
  assert(wallet?.currency === 'USDT' && wallet.chain === 'tron' && wallet.address === 'Tresource', 'resource data changed');
  assert(!result.writes.some(w => w.path.endsWith('/bridge_balance_ledger')), 'lifecycle fabricated money movement');
});
Deno.test('partial lifecycle omits missing address and status instead of clearing them', async () => {
  const result = await exercise('wallet.updated', { customer_id: 'customer', chain: 'base', currency: 'usdc', address: '' });
  const wallet = result.writes.find(w => w.path.endsWith('/bridge_wallets'))?.body;
  assert(wallet && !('address' in wallet) && !('status' in wallet), 'missing fields must not replace persisted descriptors');
  assert(!result.writes.some(w => w.path.endsWith('/api_tenant_resources')), 'missing status reset partner resource');
});
Deno.test('failed resource writes do not mark the webhook completed', async () => {
  const result = await exercise('wallet.created', { customer_id: 'customer', currency: 'usdc', chain: 'base' }, true);
  assert(result.error?.includes('wallet resource projection failed'), 'write error ignored');
  assert(!result.writes.some(w => w.path.endsWith('/complete_pending_event')), 'failed write marked completed');
});
