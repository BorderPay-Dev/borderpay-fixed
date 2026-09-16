// Real authorization endpoint, transfer endpoint, and Bridge serializer. Only
// external HTTP transports are replaced; no customer credentials or funds.
const base = 'https://initiation-test.invalid';
const bridge = 'https://initiation-bridge.invalid';
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', bridge);
Deno.env.set('BRIDGE_API_KEY', 'test-only');
Deno.env.set('BRIDGE_TRANSFERS_ENABLED', 'true');
Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true');
type Handler = (request: Request) => Promise<Response>;
let captured: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { captured = fn; return {}; }) as typeof Deno.serve;
let authorize: Handler, transfer: Handler;
try {
  await import('../supabase/functions/sca-authorize/index.ts'); authorize = captured!;
  await import('../supabase/functions/bridge-transfer/index.ts'); transfer = captured!;
} finally { Deno.serve = serve; }
const { bridgeProvider } = await import('../supabase/functions/_shared/providers/bridge.ts');
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const authorizationId = '5c2b50d6-2dda-49c7-87bd-b738d5a2554b';
const address = `0x${'a'.repeat(40)}`;
const payment = (currency = 'EURC') => ({
  idempotency_key: 'initiation-send-123',
  source: { payment_rail: 'bridge_wallet', bridge_wallet_id: 'base-wallet', currency, amount: '150' },
  destination: { payment_rail: 'base', currency, address, external_wallet_id: 'saved-1' },
});
function setup() {
  const state = {
    country: 'FR', wallet: { id: 'base-wallet', initiation_required: true } as Record<string, unknown>,
    walletHttpStatus: 200, preparationFails: false, lookupFails: false, acceptAuditFails: false,
    authorization: null as any, priorTransaction: null as any,
    sent: [] as any[], audits: [] as any[], sequence: [] as string[],
    persistence: [] as any[], transientPostFailure: false, rejectAllPosts: false,
  };
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin === bridge) {
      if (request.method === 'GET') {
        assert(url.pathname === '/v0/customers/customer/wallets/base-wallet', 'must read exact wallet under canonical owner');
        state.sequence.push('wallet');
        return Response.json(state.wallet, { status: state.walletHttpStatus });
      }
      assert(url.pathname === '/v0/transfers' && request.method === 'POST', 'unexpected Bridge mutation');
      state.sequence.push('post'); state.sent.push(await request.json());
      assert(request.headers.get('Idempotency-Key') === 'borderpay:transfer:owner:initiation-send-123', 'stable owner-bound idempotency');
      if (state.transientPostFailure && state.sent.length === 1) return Response.json({}, { status: 500 });
      if (state.rejectAllPosts) return Response.json({}, { status: 400 });
      return Response.json({ id: 'transfer-result', state: 'payment_processed' }, { headers: { 'x-request-id': 'bridge-request-123' } });
    }
    assert(url.origin === base, 'unexpected network');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: 'business', country: 'GB', account_status: 'active', bridge_customer_id: 'customer', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: 'owner', country: state.country, bridge_customer_id: 'customer', bridge_kyb_status: 'approved' }]);
    if (url.pathname.endsWith('/user_security')) return Response.json([{}]);
    if (url.pathname.endsWith('/verify-pin') || url.pathname.endsWith('/verify-2fa')) {
      state.sequence.push(url.pathname.endsWith('/verify-pin') ? 'pin' : 'totp');
      return Response.json({ success: true, totp_counter_consumed: true });
    }
    if (url.pathname.endsWith('/sca_audit_events')) return request.method === 'HEAD'
      ? new Response(null, { headers: { 'content-range': '0-0/0' } }) : new Response(null, { status: 201 });
    if (url.pathname.endsWith('/sca_authorizations')) {
      state.authorization = { ...await request.json(), id: authorizationId, consumed_at: null };
      return Response.json(state.authorization);
    }
    if (url.pathname.endsWith('/rpc/consume_sca_authorization')) {
      state.sequence.push('consume');
      const params = await request.json(), auth = state.authorization;
      const valid = auth && !auth.consumed_at && auth.user_id === params.p_user_id
        && auth.id === params.p_authorization_id && auth.operation === params.p_operation
        && auth.resource === params.p_resource && auth.payload_hash === params.p_payload_hash
        && Date.parse(auth.expires_at) > Date.now();
      if (valid) auth.consumed_at = new Date().toISOString();
      return Response.json(Boolean(valid));
    }
    if (url.pathname.endsWith('/admin_action_audit')) {
      if (request.method === 'GET') {
        if (state.lookupFails) return Response.json({ message: 'unavailable' }, { status: 400 });
        const first = state.audits.find(a => a.action_type === 'bridge_transfer_initiation_prepared');
        return Response.json(first ? [{ after_state: first.after_state }] : []);
      }
      const row = await request.json();
      const prepared = row.action_type === 'bridge_transfer_initiation_prepared';
      state.sequence.push(prepared ? 'prepare' : 'accepted');
      if ((prepared && state.preparationFails) || (!prepared && state.acceptAuditFails)) return Response.json({ message: 'unavailable' }, { status: 400 });
      state.audits.push(row); return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith('/transactions')) return Response.json(state.priorTransaction ? [state.priorTransaction] : []);
    if (url.pathname.endsWith('/external_wallets')) return Response.json([{ id: 'saved-1', address, asset: 'USDC', chain: 'base' }]);
    if (url.pathname.endsWith('/bridge_balance_ledger')) return Response.json([{ amount_minor: '1000000000', direction: 'credit' }]);
    if (url.pathname.endsWith('/rpc/upsert_bridge_transaction')) {
      const row = await request.json(); state.persistence.push(row);
      state.priorTransaction = { bridge_transfer_id: row.p_bridge_transfer_id, status: row.p_status };
      return Response.json(null);
    }
    if (url.pathname.endsWith('/admin_alerts')) return new Response(null, { status: 201 });
    throw new Error(`Unexpected ${request.method} ${url.pathname}`);
  };
  const call = async (fn: Handler, body: unknown, ua = 'desktop') => {
    const response = await fn(new Request(`${base}/functions/v1/test`, {
      method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  return {
    state, close: () => { globalThis.fetch = previous; },
    authorize: async (body: unknown) => {
      const result = await call(authorize, { operation: 'payment', resource: 'bridge_transfer', pin: '123456', totp: '123456', request: body });
      assert(result.status === 200 && result.body.data.authorization_id === authorizationId, JSON.stringify(result));
    },
    pay: (body: unknown, ua?: string) => call(transfer, body, ua),
  };
}
for (const currency of ['EURC', 'USDC']) for (const ua of ['desktop', 'Mozilla iPhone Mobile', 'Mozilla Android Mobile']) {
  Deno.test(`EEA ${currency} ${ua}: PIN/TOTP → wallet requirement → consume → recorded attestation → Bridge`, async () => {
    const t = setup(), body = payment(currency);
    try {
      await t.authorize(body);
      const signed = { ...body, sca_authorization_id: authorizationId };
      const result = await t.pay(signed, ua);
      assert(result.status === 200, JSON.stringify(result));
      const outbound = t.state.sent[0];
      assert(outbound.initiation.attestations.sca.outcome === 'sca_used', 'provider must receive sca_used');
      assert(outbound.initiation.channel === (ua === 'desktop' ? 'other' : 'other_mobile_payment'), 'correct channel');
      assert(outbound.initiation.subchannel === 'remote', 'remote payment');
      assert(!outbound.initiation.attestations.sca.auth_factors, 'optional factor metadata not fabricated');
      assert(outbound.destination.currency === currency.toLowerCase(), 'asset retained');
      assert(!JSON.stringify(outbound).includes(authorizationId) && !JSON.stringify(outbound).includes('123456'), 'no internal secrets in Bridge body');
      assert(t.state.sequence.join(',') === 'pin,totp,wallet,consume,prepare,post,accepted', t.state.sequence.join(','));
      const accepted = t.state.audits.find(a => a.action_type === 'bridge_transfer_initiation_accepted');
      assert(accepted.after_state.bridge_request_id === 'bridge-request-123', 'persist Bridge request ID');
      assert(JSON.stringify(accepted.after_state.initiation) === JSON.stringify(outbound.initiation), 'audit reflects serialized body');
      assert(t.state.persistence[0].p_metadata.sca_authorization_id === authorizationId, 'preserve original SCA evidence');
      const replay = await t.pay(signed, ua);
      assert(replay.body.data.replayed === true && t.state.sent.length === 1, 'completed retry must not move funds or consume again');
    } finally { t.close(); }
  });
}
Deno.test('EEA SCA stays mandatory when Bridge omits or disables initiation_required', async () => {
  for (const value of [undefined, false]) {
    const t = setup(), body = payment();
    try {
      if (value === undefined) delete t.state.wallet.initiation_required; else t.state.wallet.initiation_required = value;
      assert((await t.pay(body)).body.code === 'sca_required', 'absent wallet flag cannot waive EEA SCA');
      await t.authorize(body);
      assert((await t.pay({ ...body, sca_authorization_id: authorizationId })).status === 200, 'locally authenticated payment succeeds');
      assert(!t.state.sent[0].initiation, 'omit initiation as Bridge documents');
      assert(t.state.persistence[0].p_metadata.sca_required === true, 'record local SCA separately');
    } finally { t.close(); }
  }
});
Deno.test('wallet lookup failures, malformed flags and ownership mismatches block before consuming SCA', async () => {
  for (const fault of ['lookup', 'flag', 'wallet', 'owner', 'inactive', 'audit-lookup']) {
    const t = setup(), body = payment();
    try {
      await t.authorize(body);
      if (fault === 'lookup') t.state.walletHttpStatus = 404;
      if (fault === 'flag') t.state.wallet.initiation_required = 'true';
      if (fault === 'wallet') t.state.wallet.id = 'other-wallet';
      if (fault === 'owner') t.state.wallet.customer_id = 'other-customer';
      if (fault === 'inactive') t.state.wallet.status = 'inactive';
      if (fault === 'audit-lookup') t.state.lookupFails = true;
      assert((await t.pay({ ...body, sca_authorization_id: authorizationId })).status === 503, fault);
      assert(!t.state.authorization.consumed_at && !t.state.sent.length, 'must not consume or post');
    } finally { t.close(); }
  }
});
Deno.test('invalid authorization or evidence storage failure never reaches Bridge POST', async () => {
  for (const fault of ['expiry', 'owner', 'amount', 'used', 'evidence']) {
    const t = setup(), body = payment();
    try {
      await t.authorize(body);
      if (fault === 'expiry') t.state.authorization.expires_at = new Date(0).toISOString();
      if (fault === 'owner') t.state.authorization.user_id = 'other-owner';
      if (fault === 'amount') body.source.amount = '151';
      if (fault === 'used') t.state.authorization.consumed_at = new Date().toISOString();
      if (fault === 'evidence') t.state.preparationFails = true;
      const result = await t.pay({ ...body, sca_authorization_id: authorizationId });
      assert(result.status === (fault === 'evidence' ? 503 : 403), JSON.stringify(result));
      assert(!t.state.sent.length, 'must not send payment');
    } finally { t.close(); }
  }
});
Deno.test('automatic retries preserve identical initiation and idempotency', async () => {
  const t = setup(), body = payment();
  try {
    await t.authorize(body); t.state.transientPostFailure = true;
    assert((await t.pay({ ...body, sca_authorization_id: authorizationId }, 'iPhone')).status === 200, 'retry succeeds');
    assert(t.state.sent.length === 2 && JSON.stringify(t.state.sent[0]) === JSON.stringify(t.state.sent[1]), 'same serialized request');
  } finally { t.close(); }
});
Deno.test('client retry retains original channel; changed payment with same key fails before consume', async () => {
  const t = setup(), body = payment();
  try {
    await t.authorize(body); t.state.rejectAllPosts = true;
    assert((await t.pay({ ...body, sca_authorization_id: authorizationId }, 'iPhone')).status === 502, 'initial provider rejection');
    await t.authorize(body); t.state.rejectAllPosts = false;
    assert((await t.pay({ ...body, sca_authorization_id: authorizationId }, 'desktop')).status === 200, 'retry succeeds');
    assert(JSON.stringify(t.state.sent[0]) === JSON.stringify(t.state.sent[1]), 'retain original initiation despite changed device');
    t.state.priorTransaction = null; body.source.amount = '151'; await t.authorize(body);
    assert((await t.pay({ ...body, sca_authorization_id: authorizationId })).body.code === 'initiation_retry_mismatch', 'changed key payload blocked');
    assert(!t.state.authorization.consumed_at && t.state.sent.length === 2, 'no new consumption/payment');
  } finally { t.close(); }
});
Deno.test('Bridge-required initiation outside local scope cannot invent an SCA exemption', async () => {
  const t = setup();
  try {
    t.state.country = 'GB';
    assert((await t.pay(payment('USDC'))).body.code === 'bridge_wallet_sca_required', 'fail closed on scope conflict');
    assert(!t.state.sent.length, 'no transfer');
    let rejected = false;
    try { await bridgeProvider.createTransfer({ ...payment(), on_behalf_of: 'customer' } as any); } catch { rejected = true; }
    assert(rejected && !t.state.sent.length, 'provider boundary also guards callers without a preflight');
  } finally { t.close(); }
});
Deno.test('acceptance audit failure retains pre-send evidence and persists the accepted transfer', async () => {
  const t = setup(), body = payment();
  try {
    await t.authorize(body); t.state.acceptAuditFails = true;
    const result = await t.pay({ ...body, sca_authorization_id: authorizationId });
    assert(result.status === 200 && t.state.persistence.length === 1, 'accepted transfer is still persisted');
    assert(t.state.audits.length === 1 && t.state.audits[0].action_type === 'bridge_transfer_initiation_prepared', 'outbound evidence remains');
  } finally { t.close(); }
});
