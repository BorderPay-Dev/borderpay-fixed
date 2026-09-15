// Runtime contract tests: real scope resolver, consumer, and provider serializer.
// No live customers, credentials, or money movement are used.
Deno.env.set('BRIDGE_API_KEY', 'test-only');
Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true');
const { resolveBridgeScaScope, normalizeBridgeScaCountry } = await import('../supabase/functions/_shared/bridge-sca-scope.ts');
const { consumeScaAuthorization, scaPayloadHash } = await import('../supabase/functions/_shared/sca.ts');
const { bridgeProvider } = await import('../supabase/functions/_shared/providers/bridge.ts');
const { validateBridgePayout } = await import('../supabase/functions/_shared/bridge-payout-validator.ts');
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
const userId = 'test-user';
const authorizationId = 'd69a66b2-eafd-4378-a956-cd84769aa4fb';
const request = (currency: 'USDC' | 'EURC' = 'USDC') => ({
  idempotency_key: 'payout-attempt-123',
  source: { payment_rail: 'bridge_wallet' as const, bridge_wallet_id: 'wallet-1', currency, amount: '14' },
  destination: { payment_rail: 'base' as const, currency, address: `0x${'a'.repeat(40)}`, external_wallet_id: 'saved-1' },
});
function database(country: string | null = 'IT', options: { businessMissing?: boolean; rpcError?: boolean } = {}) {
  const state = { consumed: false, hash: '', rpcCalls: 0, expires: Date.now() + 60000, owner: userId };
  return {
    state,
    from(table: string) {
      const query = {
        select(_columns: string) { return query; },
        eq(_key: string, _value: unknown) { return query; },
        maybeSingle() {
          return Promise.resolve({ data: table === 'user_profiles'
            ? { id: userId, account_type: 'business', country: 'GB', bridge_customer_id: 'customer-1', bridge_kyc_status: 'approved' }
            : options.businessMissing ? null : { user_id: userId, country, bridge_customer_id: 'customer-1', bridge_kyb_status: 'approved' }, error: null });
        },
        limit(_n: number) { return Promise.resolve({ data: table === 'business_profiles' ? [{ user_id: userId }] : [{ id: userId }], error: null }); },
      };
      return query;
    },
    rpc(_name: string, params: Record<string, unknown>) {
      state.rpcCalls++;
      if (options.rpcError) return Promise.resolve({ data: null, error: { code: 'unavailable' } });
      const valid = params.p_authorization_id === authorizationId && params.p_user_id === state.owner
        && params.p_operation === 'payment' && params.p_resource === 'bridge_transfer'
        && params.p_payload_hash === state.hash && !state.consumed && state.expires > Date.now();
      if (valid) state.consumed = true;
      return Promise.resolve({ data: valid, error: null });
    },
  };
}
const consume = (db: ReturnType<typeof database>, body = request(), id: unknown = authorizationId) => consumeScaAuthorization({
  supabase: db, userId, authorizationId: id, operation: 'payment', resource: 'bridge_transfer', request: body,
});

Deno.test('EEA payout scope uses incorporation even if wallet API is unavailable', async () => {
  const original = bridgeProvider.listWallets;
  bridgeProvider.listWallets = () => { throw new Error('wallet listing must not control payment SCA'); };
  try {
    for (const country of ['IT', 'ITA', 'FR', 'NO', 'IS', 'LI']) {
      const result = await resolveBridgeScaScope(database(country), userId, 'payment');
      assert(result.required && result.reason === 'eea_payment');
    }
  } finally { bridgeProvider.listWallets = original; }
});
Deno.test('missing business country cannot fall back to non-EEA contact residence', async () => {
  for (const country of [null, '', 'ZZ', 'XXX']) {
    const result = await resolveBridgeScaScope(database(country), userId, 'payment');
    assert(result.status === 'unknown', String(country));
    assert(!(await consume(database(country))).ok);
  }
  assert((await resolveBridgeScaScope(database(null, { businessMissing: true }), userId, 'payment')).status === 'unknown');
  assert(normalizeBridgeScaCountry('ZZ') === null);
});
Deno.test('disabled SCA blocks EEA payments, while non-EEA remains outside scope', async () => {
  Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'false');
  try {
    const result = await consume(database());
    assert(!result.ok && result.status === 503);
    for (const country of ['GB', 'GBR', 'CH', 'KE', 'US']) {
      const nonEea = await consume(database(country));
      assert(nonEea.ok && !nonEea.required);
    }
  } finally { Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true'); }
});
Deno.test('EEA payment rejects absent authorization before consume RPC', async () => {
  const db = database();
  const missing = await consume(db, request(), '');
  assert(!missing.ok && missing.body.code === 'sca_required');
  assert(db.state.rpcCalls === 0);
});
Deno.test('payload changes, wrong owner, expiry, DB failure and replay reject authorization', async () => {
  for (const failure of ['amount', 'recipient', 'currency', 'key', 'owner', 'expiry', 'db']) {
    const db = database('IT', { rpcError: failure === 'db' });
    db.state.hash = await scaPayloadHash('bridge_transfer', request());
    const body = request();
    if (failure === 'amount') body.source.amount = '15';
    if (failure === 'recipient') body.destination.address = `0x${'b'.repeat(40)}`;
    if (failure === 'currency') body.destination.currency = 'EURC';
    if (failure === 'key') body.idempotency_key = 'different-attempt';
    if (failure === 'owner') db.state.owner = 'other-user';
    if (failure === 'expiry') db.state.expires = Date.now() - 1;
    assert(!(await consume(db, body)).ok, failure);
  }
  const db = database();
  db.state.hash = await scaPayloadHash('bridge_transfer', request());
  assert((await consume(db)).ok);
  const replay = await consume(db);
  assert(!replay.ok && replay.body.code === 'sca_invalid');
});
Deno.test('EURC and USDC Base payments serialize SCA attestation after successful consume', async () => {
  const originalFetch = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'transfer-1', state: 'awaiting_funds' });
  };
  try {
    for (const country of ['IT', 'GB']) for (const currency of ['USDC', 'EURC'] as const) {
      const db = database(country);
      const body = request(currency);
      assert(validateBridgePayout(body).ok, `${country} ${currency} must be withdrawable`);
      db.state.hash = await scaPayloadHash('bridge_transfer', body);
      const sca = await consume(db, body);
      assert(sca.ok);
      await bridgeProvider.createTransfer({
        ...body, on_behalf_of: 'customer-1',
        ...(sca.required ? { sca_attestation: { outcome: 'sca_used', channel: 'other', subchannel: 'remote' } as const } : {}),
      });
      const payload = sent.at(-1);
      assert(payload.destination.currency === currency.toLowerCase());
      assert(payload.destination.to_address === body.destination.address);
      assert(country === 'IT' ? payload.initiation.attestations.sca.outcome === 'sca_used' : !payload.initiation);
      assert(!JSON.stringify(payload).includes(authorizationId), 'internal authorization ID is not a provider credential');
    }
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('alternate payout routes reject EEA and unresolved owners without SCA', async () => {
  const { guardUnattestedTransfer } = await import('../supabase/functions/_shared/unattested-transfer-guard.ts');
  for (const owner of [{ userId }, { customerId: 'customer-1' }]) {
    const eea = await guardUnattestedTransfer(database('IT'), owner);
    assert(!eea.ok && eea.status === 403);
    assert((await guardUnattestedTransfer(database('GB'), owner)).ok);
    const missingCountry = await guardUnattestedTransfer(database(null), owner);
    assert(!missingCountry.ok && missingCountry.status === 503);
  }
  assert(!(await guardUnattestedTransfer(database('GB'), {})).ok);
  assert(!(await guardUnattestedTransfer(database('GB'), { customerId: 'other-customer' })).ok);
});
