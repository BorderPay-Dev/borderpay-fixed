import { assertEquals } from 'jsr:@std/assert';
import { selectVaLinkedBaseWallet } from '../utils/financial/vaLinkedWalletPresentation.ts';
const base = 'https://va-sync-db.invalid', bridge = 'https://va-sync-provider.invalid';
Deno.env.set('SUPABASE_URL', base); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', bridge); Deno.env.set('BRIDGE_API_KEY', 'test-only');
type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
const serve = Deno.serve;
Deno.serve = ((fn: Handler) => { handler = fn; return {}; }) as typeof Deno.serve;
try { await import('../supabase/functions/bridge-sync-accounts/index.ts'); } finally { Deno.serve = serve; }

Deno.test('sync uses live VA routing, mirrors only linked Base and leaves unlinked wallets untouched', async () => {
  const original = globalThis.fetch;
  const destination = (id: string) => ({ payment_rail: 'base', currency: 'eurc', bridge_wallet_id: id });
  const wallets: any[] = [
    { id: 'old-row', bridge_wallet_id: 'unlinked', chain: 'base', currency: 'USDC', address: '0xold', status: 'active' },
    { id: 'linked-row', bridge_wallet_id: 'linked', chain: 'base', currency: 'USDC', address: '', status: 'active' },
  ];
  const vas: any[] = [{ id: 'va-row', bridge_virtual_account_id: 'va', status: 'active', currency: 'EUR', account_details: { destination: destination('unlinked') } }];
  const walletWrites: string[] = [], providerCalls: string[] = [];
  let failVas = false;
  let addressOnly = false;
  let ambiguousAddress = false;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.origin === bridge) {
      assertEquals(req.method, 'GET'); providerCalls.push(url.pathname);
      if (url.pathname.endsWith('/virtual_accounts')) {
        if (failVas) return Response.json({ message: 'unavailable' }, { status: 400 });
        return Response.json({ data: [{ id: 'va', status: 'active', source_deposit_instructions: { currency: 'eur', payment_rail: 'sepa' }, destination: addressOnly ? { payment_rail: 'base', currency: 'eurc', address: '0xlinked' } : destination('linked') }] });
      }
      if (url.pathname.endsWith('/wallets')) return Response.json({ data: [
        { id: 'unlinked', chain: 'base', status: 'active', address: ambiguousAddress ? '0xlinked' : '0xold' },
        { id: 'linked', chain: 'base', status: 'active', address: '0xlinked' },
      ] });
      throw new Error('Must not fetch or mutate an individual unlinked wallet');
    }
    assertEquals(url.origin, base);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ account_type: 'business', bridge_customer_id: 'customer' }]);
    const isWallet = url.pathname.endsWith('/bridge_wallets');
    if (isWallet || url.pathname.endsWith('/bridge_virtual_accounts')) {
      const rows = isWallet ? wallets : vas;
      if (req.method === 'GET') {
        const field = isWallet ? 'bridge_wallet_id' : 'bridge_virtual_account_id';
        const eq = url.searchParams.get(field);
        if (eq) return Response.json(rows.filter(row => `eq.${row[field]}` === eq));
        assertEquals(url.searchParams.get('business_user_id'), 'eq.owner');
        return Response.json(rows);
      }
      assertEquals(req.method, 'PATCH');
      const row = rows.find(r => `eq.${r.id}` === url.searchParams.get('id'));
      const patch = await req.json();
      if (isWallet) walletWrites.push(patch.bridge_wallet_id);
      Object.assign(row, patch);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${req.method} ${url.pathname}`);
  };
  const request = () => new Request(`${base}/functions/v1/bridge-sync-accounts`, { method: 'POST', headers: { Authorization: 'Bearer session' } });
  try {
    const response = await handler(request()), result = await response.json();
    assertEquals(response.status, 200);
    assertEquals(walletWrites, ['linked']);
    assertEquals(result.data.wallets.map((w: any) => w.bridge_wallet_id), ['linked']);
    assertEquals(result.data.wallets[0].address, '0xlinked');
    assertEquals(vas[0].account_details.destination.bridge_wallet_id, 'linked');
    assertEquals(wallets[0].address, '0xold');
    assertEquals(wallets[0].status, 'active');
    assertEquals(providerCalls, ['/v0/customers/customer/virtual_accounts', '/v0/customers/customer/wallets']);
    addressOnly = true;
    const addressResult = await (await handler(request())).json();
    assertEquals(addressResult.data.warnings, []);
    assertEquals(vas[0].account_details.destination.bridge_wallet_id, 'linked');
    assertEquals(vas[0].account_details.bridge_provider_raw.destination.bridge_wallet_id, undefined);
    assertEquals(vas[0].account_details.wallet_binding.source, 'provider_wallet_address_match');
    // Released clients omitted wallet.address. The normalized VA ID must still
    // resolve the funded resource, without choosing an unrelated Base wallet.
    const oldClientRows = wallets.map(({ address: _address, ...row }) => row);
    assertEquals(selectVaLinkedBaseWallet(oldClientRows, vas)?.bridge_wallet_id, 'linked');
    ambiguousAddress = true;
    walletWrites.length = 0;
    await handler(request());
    assertEquals(walletWrites, []);
    assertEquals(vas[0].account_details.destination.bridge_wallet_id, undefined);
    assertEquals(vas[0].account_details.wallet_binding, null);
    assertEquals(selectVaLinkedBaseWallet(oldClientRows, vas), null);
    ambiguousAddress = false;
    await handler(request());
    failVas = true; walletWrites.length = 0;
    const unavailable = await (await handler(request())).json();
    assertEquals(walletWrites, []);
    assertEquals(unavailable.data.wallets, []);
    assertEquals(unavailable.data.warnings.includes('virtual_account_sync_failed'), true);
    assertEquals(vas[0].account_details.destination.bridge_wallet_id, 'linked');
    const unauthorized = await handler(new Request(`${base}/test`, { method: 'POST' }));
    assertEquals(unauthorized.status, 401);
  } finally { globalThis.fetch = original; }
});
