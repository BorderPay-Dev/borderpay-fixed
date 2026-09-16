// Exercise the real authenticated handler and provider adapter without live funds.
import { assert, assertEquals } from 'jsr:@std/assert';
const base = 'https://outcome-test.invalid', provider = 'https://outcome-bridge.invalid';
for (const [key, value] of Object.entries({ SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'test', BRIDGE_BASE_URL: provider,
  BRIDGE_API_KEY: 'test', BRIDGE_TRANSFERS_ENABLED: 'true', BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED: 'true' })) Deno.env.set(key, value);
type Handler = (request: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/bridge-transfer/index.ts'); } finally { Deno.serve = serve; }
const { bridgeProvider, BridgeProviderError } = await import('../supabase/functions/_shared/providers/bridge.ts');

Deno.test('accepted EEA transfer survives persistence failure, replays without SCA reuse, and reports real rejections', async () => {
  const originalFetch = globalThis.fetch, originalCreate = bridgeProvider.createTransfer, originalLog = console.log;
  const id = '80fa5fb8-b51a-4263-aab6-7e9f67c19a3e';
  const address = `0x${'a'.repeat(40)}`;
  let balance = 20_000_000, accepted: any = null, prepared: any = null, persistenceFails = true;
  let providerState = 'payment_processed', accountStatus = 'active', authorization = 'cb2f6227-c7ff-4df7-81ac-9f4e630c6a15';
  let providerError: any = null, throwAcceptedAudit = false;
  let sent = 0, consumed = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin === provider) {
      if (request.method === 'GET' && url.pathname.endsWith('/wallets/base-wallet')) {
        return Response.json({ id: 'base-wallet', customer_id: 'customer', chain: 'base', initiation_required: true });
      }
      assertEquals(url.pathname, '/v0/transfers');
      assertEquals(request.method, 'POST');
      sent++;
      const body = await request.json();
      assertEquals(body.source.currency, 'eurc');
      assertEquals(body.initiation.attestations.sca.outcome, 'sca_used');
      return providerError ? Response.json(providerError, { status: 400 }) : Response.json({ id, state: providerState });
    }
    assertEquals(url.origin, base);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: 'business', country: 'GB', account_status: accountStatus, bridge_customer_id: 'customer', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: 'owner', country: 'LV', bridge_customer_id: 'customer', bridge_kyb_status: 'approved' }]);
    if (url.pathname.endsWith('/transactions')) return Response.json([]);
    if (url.pathname.endsWith('/external_wallets')) return Response.json([{ id: 'saved', address, asset: 'EURC', chain: 'base' }]);
    if (url.pathname.endsWith('/bridge_balance_ledger')) {
      assertEquals(url.searchParams.get('currency'), 'eq.EURC');
      return Response.json([{ amount_minor: balance, direction: 'credit' }]);
    }
    if (url.pathname.endsWith('/rpc/consume_sca_authorization')) { consumed++; return Response.json(true); }
    if (url.pathname.endsWith('/rpc/upsert_bridge_transaction')) return persistenceFails
      ? Response.json({ code: 'test_write_failure', message: 'projection write failed' }, { status: 400 }) : Response.json(null);
    if (url.pathname.endsWith('/admin_action_audit')) {
      if (request.method === 'GET') {
        const row = url.searchParams.get('action_type') === 'eq.bridge_transfer_initiation_accepted' ? accepted : prepared;
        return Response.json(row ? [{ after_state: row }] : []);
      }
      const row = await request.json();
      if (row.action_type === 'bridge_transfer_initiation_accepted') {
        if (throwAcceptedAudit) throw new Error('audit transport unavailable');
        accepted = row.after_state;
      } else prepared = row.after_state;
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith('/admin_alerts')) return new Response(null, { status: 201 });
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  const call = async (amount = '10') => {
    const response = await handler(new Request(`${base}/functions/v1/bridge-transfer`, { method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify({
      idempotency_key: 'test-payment-123', sca_authorization_id: authorization,
      source: { payment_rail: 'bridge_wallet', bridge_wallet_id: 'base-wallet', currency: 'EURC', amount },
      destination: { payment_rail: 'base', currency: 'EURC', address, external_wallet_id: 'saved' },
    }) }));
    return { status: response.status, body: await response.json() };
  };
  try {
    let result = await call();
    assertEquals(result.status, 200); assertEquals(result.body.success, true);
    assertEquals(result.body.data.transfer_id, id); assertEquals(result.body.data.state, 'succeeded');
    assertEquals(result.body.data.reconciliation_pending, true);
    assertEquals(sent, 1); assertEquals(consumed, 1);
    balance = 0; authorization = '';
    result = await call();
    assertEquals(result.body.data.replayed, true);
    assertEquals(sent, 1); assertEquals(consumed, 1);
    assertEquals((await call('11')).body.code, 'initiation_retry_mismatch');
    assertEquals(sent, 1);
    accepted = null; prepared = null; balance = 1_000_000;
    assertEquals((await call()).body.code, 'insufficient_balance', '1 EURC must not cover 10 EURC');
    assertEquals(consumed, 1);
    balance = 20_000_000;
    assertEquals((await call()).body.code, 'sca_required');
    authorization = 'cb2f6227-c7ff-4df7-81ac-9f4e630c6a15';
    providerState = 'payment_submitted';
    result = await call();
    assert(result.body.success); assertEquals(result.body.code, 'provider_confirmation_pending');
    assertEquals(result.body.data.state, 'pending');
    accepted = null; prepared = null;
    providerError = { code: 'invalid_parameters', message: 'invalid parameters', source: { location: 'body', key: { amount: 'is higher than the balance of the wallet' } } };
    assertEquals((await call()).body.code, 'insufficient_balance');
    providerError.source.key = { address: 'invalid address' };
    assertEquals((await call()).body.code, 'bridge_provider_error', 'do not relabel unrelated validation failures');
    providerError = null; providerState = 'error'; persistenceFails = false;
    result = await call();
    assertEquals(result.body.success, false); assertEquals(result.body.code, 'transfer_failed');
    accepted = null; prepared = null; providerState = 'payment_processed'; throwAcceptedAudit = true;
    result = await call();
    assertEquals(result.body.success, true); assertEquals(result.body.data.transfer_id, id);
    throwAcceptedAudit = false; accepted = null; prepared = null;
    console.log = (...args: unknown[]) => {
      if (String(args[0]).includes('"stage":"bridge_response_received"')) throw new Error('post-acceptance logging failure');
      originalLog(...args);
    };
    result = await call();
    assertEquals(result.body.success, true); assertEquals(result.body.data.transfer_id, id);
    assertEquals(result.body.data.reconciliation_pending, true);
    console.log = originalLog;
    accepted = null; prepared = null;
    bridgeProvider.createTransfer = async () => { throw new BridgeProviderError('response lost', { status: 0 }); };
    assertEquals((await call()).body.code, 'response_unconfirmed');
    bridgeProvider.createTransfer = originalCreate;
    accountStatus = 'frozen';
    assertEquals((await call()).body.code, 'account_frozen');
  } finally { globalThis.fetch = originalFetch; bridgeProvider.createTransfer = originalCreate; console.log = originalLog; }
});
