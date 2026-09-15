Deno.env.set('SUPABASE_URL', 'https://transfer-owner-db.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('SEND_EMAIL_INTERNAL_TOKEN', '');
const serve = Deno.serve;
Deno.serve = (() => ({})) as unknown as typeof Deno.serve;
let handleBridgeTransfer: typeof import('../supabase/functions/process-pending-events/index.ts').handleBridgeTransfer;
try {
  ({ handleBridgeTransfer } = await import('../supabase/functions/process-pending-events/index.ts'));
} finally { Deno.serve = serve; }
const ownerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}
type Scenario = 'business' | 'individual' | 'unmapped' | 'ambiguous' | 'lookup_error';
async function exercise(payload: Record<string, unknown>, scenario: Scenario = 'business') {
  const originalFetch = globalThis.fetch;
  const writes: Array<{ path: string; body: any }> = [];
  const lookups: string[] = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== 'https://transfer-owner-db.invalid') throw new Error('Transfer webhook must not call a payment provider');
    if (req.method !== 'GET') {
      const body = await req.json(); writes.push({ path: url.pathname, body });
      if (url.pathname.includes('/rpc/')) return Response.json(null);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/business_profiles') || url.pathname.endsWith('/user_profiles')) {
      lookups.push(url.searchParams.get('bridge_customer_id') || '');
      if (url.pathname.endsWith('/business_profiles')) {
        if (scenario === 'lookup_error') return Response.json({ message: 'lookup unavailable' }, { status: 400 });
        return Response.json(['business', 'ambiguous'].includes(scenario) ? [{ user_id: ownerId }] : []);
      }
      return Response.json(scenario === 'unmapped' ? [] : [{ id: scenario === 'ambiguous' ? otherId : ownerId, account_type: scenario === 'individual' ? 'individual' : 'business' }]);
    }
    if (url.pathname.endsWith('/notifications')) return Response.json([]);
    throw new Error(`Unexpected read: ${url.pathname}`);
  };
  let error: string | null = null;
  try {
    await handleBridgeTransfer({ source: 'bridge', event_id: 'bridge:wh-fixture', event_type: 'transfer.updated.status_transitioned',
      payload: { event_object: { id: 'transfer-fixture', amount: '150', currency: 'eur', state: 'payment_processed',
        source: { payment_rail: 'bridge_wallet', currency: 'eurc' },
        destination: { payment_rail: 'base', currency: 'eurc' }, ...payload } } } as any);
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  finally { globalThis.fetch = originalFetch; }
  return { error, writes, lookups };
}
Deno.test('business EURC webhook resolves on_behalf_of and writes exactly the business owner', async () => {
  const result = await exercise({ on_behalf_of: 'customer-fixture' });
  equal(result.error, null);
  const projection = result.writes.find(w => w.path.endsWith('/upsert_bridge_transfer_projection'))?.body;
  equal(projection.p_user_id, null); equal(projection.p_business_user_id, ownerId);
  equal(projection.p_state, 'succeeded'); equal(projection.p_amount, 150);
  const tx = result.writes.find(w => w.path.endsWith('/upsert_bridge_transaction'))?.body;
  equal(tx.p_user_id, ownerId); equal(tx.p_status, 'completed');
  if (!result.writes.some(w => w.path.endsWith('/complete_pending_event'))) throw new Error('Webhook did not complete');
  if (result.writes.some(w => /consume_sca|apply_bridge|balance_ledger|wallet_balance/.test(w.path))) throw new Error('Projection must not reauthorize or move funds');
  if (result.lookups.some(q => q !== 'eq.customer-fixture')) throw new Error('Incorrect customer lookup');
});
Deno.test('individual transfer maps only the individual owner', async () => {
  const result = await exercise({ on_behalf_of: 'customer-fixture' }, 'individual');
  equal(result.error, null);
  const projection = result.writes.find(w => w.path.endsWith('/upsert_bridge_transfer_projection'))?.body;
  equal(projection.p_user_id, ownerId); equal(projection.p_business_user_id, null);
});
Deno.test('legacy customer_id still resolves the existing owner', async () => {
  equal((await exercise({ customer_id: 'customer-fixture', state: 'awaiting_funds' })).error, null);
});
Deno.test('canonical transfer customer is not replaced by an endpoint counterparty', async () => {
  const result = await exercise({ on_behalf_of: 'customer-fixture', source: { payment_rail: 'bridge_wallet', customer_id: 'counterparty' } });
  equal(result.error, null);
  if (result.lookups.some(q => q !== 'eq.customer-fixture')) throw new Error('Counterparty selected as owner');
});
Deno.test('missing, unmapped, ambiguous and failed lookups stop before projection or partner status writes', async () => {
  for (const [payload, scenario] of [
    [{}, 'business'], [{ on_behalf_of: 'customer-fixture' }, 'unmapped'],
    [{ on_behalf_of: 'customer-fixture' }, 'ambiguous'], [{ on_behalf_of: 'customer-fixture' }, 'lookup_error'],
  ] as Array<[Record<string, unknown>, Scenario]>) {
    const result = await exercise(payload, scenario);
    if (!result.error?.startsWith('reconciliation_required:')) throw new Error(String(result.error));
    if (result.writes.some(w => !w.path.endsWith('/bridge_webhook_events'))) throw new Error('Unresolved ownership changed state');
  }
});
Deno.test('conflicting customer aliases and malformed IDs fail without changing any records', async () => {
  for (const payload of [
    { on_behalf_of: 'customer-a', customer_id: 'customer-b' },
    { on_behalf_of: { id: 'customer-fixture' } },
    { source: { customer_id: 'customer-a' }, destination: { customer_id: 'customer-b' } },
  ]) {
    const result = await exercise(payload);
    if (!result.error?.startsWith('reconciliation_required:')) throw new Error(String(result.error));
    equal(result.writes.length, 0);
  }
});
