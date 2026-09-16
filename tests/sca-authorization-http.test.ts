// Exercise the actual HTTP handlers and TOTP cryptography. Supabase persistence
// is replaced by an in-memory HTTP stub; this does not certify production SQL.
const base = 'https://sca-test.invalid';
const uid = '5f24baca-00be-4a15-a635-3e368d978c17';
const aid = '2aa6cb8f-4c8c-4f84-8d04-54b0ae13d46a';
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const encryptionKey = new Uint8Array(32).fill(7);
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('SUPABASE_ANON_KEY', 'test-only');
Deno.env.set('TOTP_ENCRYPTION_KEY', b64(encryptionKey));
Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true');
Deno.env.set('BRIDGE_API_KEY', 'test-only');
Deno.env.set('BRIDGE_TRANSFERS_ENABLED', 'true');

type Handler = (req: Request) => Response | Promise<Response>;
const handlers: Record<string, Handler> = {};
const realServe = Deno.serve;
let loading = '';
Deno.serve = ((handler: Handler) => { handlers[loading] = handler; return {}; }) as typeof Deno.serve;
try {
  loading = 'verify-2fa'; await import('../supabase/functions/verify-2fa/index.ts');
  loading = 'sca-authorize'; await import('../supabase/functions/sca-authorize/index.ts');
  loading = 'bridge-transfer'; await import('../supabase/functions/bridge-transfer/index.ts');
} finally { Deno.serve = realServe; }
function assert(value: unknown, message = 'assertion failed'): void { if (!value) throw new Error(message); }
// RFC 6238's ASCII test secret, encoded as base32 for the application.
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const aes = await crypto.subtle.importKey('raw', encryptionKey, 'AES-GCM', false, ['encrypt']);
const iv = new Uint8Array(12).fill(5);
const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(secret)));
const blob = b64(new Uint8Array([...iv, ...encrypted]));
async function currentTotp() {
  const counter = Math.floor(Date.now() / 30000);
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('12345678901234567890'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const offset = hmac.at(-1)! & 15;
  const number = new DataView(hmac.buffer).getUint32(offset) & 0x7fffffff;
  return String(number % 1000000).padStart(6, '0');
}
const payment = { idempotency_key: 'test-payment-key', source: { amount: '14', currency: 'EURC', payment_rail: 'bridge_wallet', bridge_wallet_id: 'wallet-1' }, destination: { currency: 'EURC', payment_rail: 'base', address: `0x${'a'.repeat(40)}`, external_wallet_id: 'saved-1' } };
const call = (name: string, body: unknown) => handlers[name](new Request(`${base}/functions/v1/${name}`, {
  method: 'POST', headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

Deno.test('PIN then real TOTP creates recorded authorization; failures and replay never authorize', async () => {
  const originalFetch = globalThis.fetch;
  let lastCounter = -1;
  let country = 'IT';
  let failAudit = false;
  let oldVerifier = false;
  const authorizations: any[] = [];
  const audit: any[] = [];
  const factors: string[] = [];
  const transfers: any[] = [];
  const transactionRows: any[] = [];
  let authorizationConsumed = false;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json() : {};
    const response = (data: unknown, status = 200) => Response.json(data, { status });
    if (url.pathname === '/v0/customers/customer-1/wallets/wallet-1') return response({ id: 'wallet-1', initiation_required: true });
    if (url.pathname.endsWith('/admin_action_audit')) return response(req.method === 'GET' ? [] : {});
    if (url.pathname === '/v0/transfers') {
      transfers.push(body);
      return response({ id: 'transfer-1', state: 'payment_processed' });
    }
    if (url.pathname.endsWith('/admin_alerts')) return response({});
    if (url.pathname.endsWith('/transactions')) {
      const key = url.searchParams.get('metadata->>idempotency_key')?.replace(/^eq\./, '');
      return response(transactionRows.filter(row => row.p_metadata.idempotency_key === key)
        .map(row => ({ bridge_transfer_id: row.p_bridge_transfer_id, status: row.p_status })));
    }
    if (url.pathname.endsWith('/external_wallets')) return response([{ id: 'saved-1', address: payment.destination.address, asset: 'EURC', chain: 'base' }]);
    if (url.pathname.endsWith('/bridge_balance_ledger')) return response([{ amount_minor: '1000000000000', direction: 'credit' }]);
    if (url.pathname.endsWith('/rpc/consume_sca_authorization')) {
      const valid = !authorizationConsumed && body.p_authorization_id === aid
        && body.p_user_id === uid && body.p_payload_hash === authorizations.at(-1)?.payload_hash;
      if (valid) authorizationConsumed = true;
      return response(valid);
    }
    if (url.pathname.endsWith('/rpc/upsert_bridge_transaction')) {
      transactionRows.push(body); return response({});
    }
    if (url.pathname === '/auth/v1/user') return response({ id: uid, email: 'test@example.invalid' });
    if (url.pathname.endsWith('/functions/v1/verify-pin')) {
      factors.push('pin');
      return response({ success: body.pin === '123456' }, body.pin === '123456' ? 200 : 401);
    }
    if (url.pathname.endsWith('/functions/v1/verify-2fa')) {
      factors.push('totp');
      if (oldVerifier) return response({ success: true });
      return await call('verify-2fa', body);
    }
    if (url.pathname.endsWith('/rpc/get_totp_secret_encrypted_b64')) return response(blob);
    if (url.pathname.endsWith('/rpc/consume_totp_counter')) {
      const fresh = body.p_counter > lastCounter;
      if (fresh) lastCounter = body.p_counter;
      return response(fresh);
    }
    if (url.pathname.endsWith('/user_profiles')) return response([{ id: uid, account_type: 'business', country: 'GB', bridge_customer_id: 'customer-1', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return response([{ user_id: uid, country, bridge_customer_id: 'customer-1', bridge_kyb_status: 'approved' }]);
    if (url.pathname.endsWith('/user_security')) return response(req.method === 'GET' ? [{ sca_recovery_restricted_until: null }] : {});
    if (url.pathname.endsWith('/sca_audit_events')) {
      if (req.method === 'HEAD') return new Response(null, { headers: { 'content-range': '0-0/0' } });
      if (failAudit && body.event_type === 'authorization_succeeded') return response({ code: 'db_error', message: 'test failure' }, 500);
      audit.push(body); return response({});
    }
    if (url.pathname.endsWith('/sca_authorizations') && req.method === 'POST') {
      authorizations.push(body);
      return response({ id: aid, expires_at: body.expires_at });
    }
    throw new Error(`Unexpected test request: ${req.method} ${url.pathname}`);
  };
  try {
    const authorize = (pin: string, totp: string) => call('sca-authorize', { operation: 'payment', resource: 'bridge_transfer', pin, totp, request: payment });
    const unprotected = await call('bridge-transfer', payment);
    assert(unprotected.status === 403 && transfers.length === 0, 'payout without SCA reached Bridge');
    const wrongPin = await authorize('999999', await currentTotp());
    assert(wrongPin.status === 401 && factors.join(',') === 'pin');
    assert(authorizations.length === 0);
    const badTotp = await authorize('123456', 'bad');
    assert(badTotp.status === 400 && authorizations.length === 0);
    const success = await authorize('123456', await currentTotp());
    const successBody = await success.json();
    assert(success.status === 200 && successBody.data.authorization_id === aid, JSON.stringify(successBody));
    assert(factors.slice(-2).join(',') === 'pin,totp');
    assert(authorizations[0].verified_factors.join(',') === 'pin,totp');
    assert(/^[a-f0-9]{64}$/.test(authorizations[0].payload_hash));
    assert(audit.some(row => row.event_type === 'authorization_succeeded' && row.authorization_id === aid));
    const submitted = await call('bridge-transfer', { ...payment, sca_authorization_id: aid });
    const submittedBody = await submitted.json();
    assert(submitted.status === 200, JSON.stringify(submittedBody));
    assert(transfers.length === 1 && transfers[0].initiation.attestations.sca.outcome === 'sca_used');
    assert(transfers[0].destination.currency === 'eurc' && transfers[0].destination.to_address === payment.destination.address);
    assert(transactionRows[0].p_metadata.sca_authorization_id === aid && transactionRows[0].p_metadata.sca_attestation_outcome === 'sca_used');
    const retry = await call('bridge-transfer', { ...payment, sca_authorization_id: aid });
    assert(retry.status === 200 && transfers.length === 1, 'idempotent retry created another transfer');
    const changedIntent = await call('bridge-transfer', { ...payment, idempotency_key: 'changed-intent-key', sca_authorization_id: aid });
    assert(changedIntent.status === 403 && transfers.length === 1, 'authorization replay moved funds');
    const replay = await authorize('123456', await currentTotp());
    assert(replay.status === 401 && authorizations.length === 1, 'same TOTP must not authorize a second payment');
    oldVerifier = true;
    const rolloutMismatch = await authorize('123456', await currentTotp());
    assert(rolloutMismatch.status === 503 && authorizations.length === 1, 'old verifier must fail closed');
    oldVerifier = false;
    lastCounter = -1;
    failAudit = true;
    const auditFailure = await authorize('123456', await currentTotp());
    assert(auditFailure.status === 503 && !(await auditFailure.json()).data, 'unrecorded success must not reach client');
    failAudit = false; lastCounter = -1;
    const beneficiary = await call('sca-authorize', { action: 'authorize', operation: 'beneficiary_change', resource: 'bridge_external_account', pin: '123456', totp: await currentTotp(), request: { action: 'delete', external_account_id: 'account-1' } });
    assert(beneficiary.status === 200, 'beneficiary authorization must be supported');
    assert(authorizations.at(-1).operation === 'beneficiary_change' && authorizations.at(-1).resource === 'bridge_external_account', 'beneficiary proof must not authorize a payment');
    assert((await call('sca-authorize', { operation: 'beneficiary_change', resource: 'bridge_transfer' })).status === 400, 'reject mismatched operation/resource');
    country = 'GB';
    const nonEea = await call('sca-authorize', { action: 'status' });
    assert((await nonEea.json()).data.required === false);
    country = 'IT';
    Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'false');
    assert((await call('sca-authorize', { action: 'status' })).status === 503);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true');
  }
});
