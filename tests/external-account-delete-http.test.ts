import { assertEquals } from 'jsr:@std/assert';
import { normalizeBridgeExternalAccounts } from '../supabase/functions/_shared/providers/bridge-external-account-list.ts';
const base = 'https://external-delete-db.invalid', bridge = 'https://external-delete-provider.invalid';
Deno.env.set('SUPABASE_URL', base); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', bridge); Deno.env.set('BRIDGE_API_KEY', 'test-only');
Deno.env.set('BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED', 'true');
const { scaPayloadHash } = await import('../supabase/functions/_shared/sca.ts');
type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/bridge-external-account/index.ts'); } finally { Deno.serve = serve; }
const authorizationId = 'cb2f6227-c7ff-4df7-81ac-9f4e630c6a15';
const accountId = '3e29ece8-634d-4236-9ece-3b6dc6e12292';
const action = { action: 'delete', external_account_id: accountId };

Deno.test('fiat deletion verifies customer ownership, consumes EEA SCA, calls DELETE then mirrors; failures never fake deletion', async () => {
  const original = globalThis.fetch;
  let country = 'FR', providerExists = true, localExists = true, wrongCustomer = false, localFailure = false, deleteFailure = false;
  let permitSca = true;
  const sequence: string[] = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.origin === bridge) {
      assertEquals(url.pathname, `/v0/customers/customer/external_accounts/${accountId}`);
      sequence.push(req.method);
      if (req.method === 'GET') return providerExists
        ? Response.json({ id: accountId, customer_id: wrongCustomer ? 'other' : 'customer', active: true })
        : Response.json({}, { status: 404 });
      assertEquals(req.method, 'DELETE');
      if (deleteFailure) return Response.json({ message: 'cannot delete' }, { status: 400 });
      providerExists = false;
      return new Response(null, { status: 204 });
    }
    assertEquals(url.origin, base);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', account_type: 'business', bridge_customer_id: 'customer', country: 'GB', bridge_kyc_status: 'approved' }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: 'owner', bridge_customer_id: 'customer', country, bridge_kyb_status: 'approved' }]);
    if (url.pathname.endsWith('/rpc/consume_sca_authorization')) {
      const params = await req.json(); sequence.push('SCA');
      assertEquals(params.p_user_id, 'owner'); assertEquals(params.p_operation, 'beneficiary_change');
      assertEquals(params.p_resource, 'bridge_external_account'); assertEquals(params.p_authorization_id, authorizationId);
      assertEquals(params.p_payload_hash, await scaPayloadHash('bridge_external_account', action));
      return Response.json(permitSca);
    }
    if (url.pathname.endsWith('/bridge_external_accounts')) {
      assertEquals(url.searchParams.get('user_id'), 'eq.owner');
      assertEquals(url.searchParams.get('bridge_customer_id'), 'eq.customer');
      assertEquals(url.searchParams.get('bridge_external_account_id'), `eq.${accountId}`);
      if (req.method === 'GET') return Response.json(localExists ? [{ id: 'local-row' }] : []);
      assertEquals(req.method, 'PATCH'); sequence.push('mirror');
      assertEquals(providerExists, false);
      const patch = await req.json(); assertEquals(patch.active, false); assertEquals(patch.status, 'deleted');
      return localFailure ? Response.json({ message: 'unavailable' }, { status: 400 }) : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${req.method} ${url.pathname}`);
  };
  const call = (authorized = true) => handler(new Request(`${base}/test`, { method: 'POST', headers: { Authorization: 'Bearer session' },
    body: JSON.stringify({ ...action, ...(authorized ? { sca_authorization_id: authorizationId } : {}) }) }));
  try {
    let r = await call(false); assertEquals(r.status, 403); assertEquals(sequence, ['GET']);
    sequence.length = 0; permitSca = false;
    r = await call(); assertEquals(r.status, 403); assertEquals(sequence, ['GET', 'SCA']);
    sequence.length = 0; permitSca = true; wrongCustomer = true;
    r = await call(); assertEquals(r.status, 409); assertEquals(sequence, ['GET']);
    sequence.length = 0; wrongCustomer = false; deleteFailure = true;
    r = await call(); assertEquals(r.status, 502); assertEquals(sequence, ['GET', 'SCA', 'DELETE']);
    sequence.length = 0; deleteFailure = false; localExists = false;
    r = await call(); assertEquals(r.status, 200); assertEquals((await r.json()).data.deleted, true);
    assertEquals(sequence, ['GET', 'SCA', 'DELETE', 'mirror']);
    sequence.length = 0; localExists = true;
    r = await call(false); assertEquals(r.status, 200); assertEquals(sequence, ['GET', 'mirror']);
    sequence.length = 0; providerExists = true; country = 'GB'; localFailure = true;
    r = await call(false); assertEquals(r.status, 200); assertEquals((await r.json()).data.reconciliation_pending, true);
    assertEquals(sequence, ['GET', 'DELETE', 'mirror']);
    sequence.length = 0; localExists = false;
    r = await call(); assertEquals(r.status, 404); assertEquals(sequence, ['GET']);
  } finally { globalThis.fetch = original; }
});

Deno.test('Bridge active=false accounts cannot reappear as active payout destinations', () => {
  const rows = normalizeBridgeExternalAccounts([
    { id: 'removed-us', currency: 'usd', account_type: 'us', active: false },
    { id: 'removed-eur', currency: 'eur', account_type: 'iban', active: false, status: 'active' },
    { id: 'live-gb', currency: 'gbp', account_type: 'gb', active: true },
  ]);
  assertEquals(rows.map(row => row.status), ['inactive', 'inactive', 'active']);
});
