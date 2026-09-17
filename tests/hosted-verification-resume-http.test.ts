// Exercise the released HTTP contract, provider resume requests and native handoff.
import { openHostedVerification } from '../utils/native/hostedVerification.ts';
const database = 'https://verification-db.invalid';
const provider = 'https://verification-bridge.invalid';
Deno.env.set('SUPABASE_URL', database);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('BRIDGE_BASE_URL', provider);
Deno.env.set('BRIDGE_API_KEY', 'test-only');
Deno.env.set('BRIDGE_ONBOARDING_ENABLED', 'true');
type Handler = (request: Request) => Promise<Response>;
const handlers: Handler[] = [];
const serve = Deno.serve;
Deno.serve = ((handler: Handler) => { handlers.push(handler); return {}; }) as typeof Deno.serve;
try {
  await import('../supabase/functions/bridge-kyc-link/index.ts');
  await import('../supabase/functions/bridge-kyb-link/index.ts');
} finally { Deno.serve = serve; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test('accepted-ToS incomplete KYC/KYB and awaiting UBO resume current customer in native browser', async () => {
  const originalFetch = globalThis.fetch;
  let business = false;
  let partner = false;
  const appOrigin = () => partner ? 'https://app.partner.example' : 'https://app.borderpayafrica.com';
  let status = 'incomplete';
  let accepted = true;
  let unavailable = false;
  let calls: string[] = [];
  const patches: any[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === database) {
      if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner', email: 'owner@example.invalid', email_confirmed_at: '2026-01-01' });
      if (request.method === 'PATCH') { patches.push(await request.json()); return new Response(null, { status: 204 }); }
      if (url.pathname.endsWith('/bridge_kyc_traces')) return new Response(null, { status: 201 });
      if (url.pathname.endsWith('/account_origin_provenance')) return Response.json(partner ? [{user_id:'owner',tenant_id:'tenant-a',onboarding_channel:'white_label'}] : []);
      if (url.pathname.endsWith('/white_label_releases')) return Response.json([{tenant_id:'tenant-a',status:'live',revision:1,domain_verified_at:'2026-09-17',published:{brand_name:'Partner',legal_name:'Partner Ltd',primary_color:'#C7FF00',logo_url:'https://partner.example/logo.png',app_origin:appOrigin(),support_email:'help@partner.example',support_url:'https://partner.example/support',terms_url:'https://partner.example/terms',privacy_url:'https://partner.example/privacy',legal_version:'v1'}}]);
      if (url.pathname.endsWith('/api_tenants')) return Response.json([{id:'tenant-a',is_active:true,default_mode:'production',metadata:{production_access:true}}]);
      if (url.pathname.endsWith('/api_partner_approvals')) return Response.json([{tenant_id:'tenant-a',status:'approved',approved_products:['white_label']}]);
      if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: 'owner', email: 'owner@example.invalid', full_name: 'Test Owner', account_type: business ? 'business' : 'individual', country: 'FR', bridge_customer_id: 'existing-customer', bridge_kyc_link_id: 'original-link', bridge_kyc_status: status, bridge_account_status: status }]);
      if (url.pathname.endsWith('/business_profiles')) return Response.json([{ company_name: 'Test Business', bridge_customer_id: 'existing-customer', bridge_kyb_status: status, bridge_kyb_link_id: 'original-link' }]);
    }
    if (url.origin === provider) {
      calls.push(`${request.method} ${url.pathname}`);
      assert(request.method === 'GET', 'resuming must never create another provider customer');
      if (unavailable) return Response.json({ message: 'unavailable' }, { status: 503 });
      if (url.pathname === '/v0/customers/existing-customer') return Response.json({ has_accepted_terms_of_service: accepted });
      if (url.pathname.endsWith('/tos_acceptance_link')) return Response.json({ url: 'https://bridge.xyz/terms/test' });
      if (url.pathname.endsWith('/kyc_link')) {
        assert(accepted, 'identity flow must follow accepted terms');
        assert(new URL(url.searchParams.get('redirect_uri') || '').origin === appOrigin(), 'native callback must be replaced with public HTTPS');
        return Response.json({ url: 'https://bridge.withpersona.com/verify?inquiry-id=current&redirect-uri=capacitor%3A%2F%2Flocalhost' });
      }
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  };
  const call = async (phase?: string) => {
    const result = await handlers[business ? 1 : 0](new Request(`${database}/functions/v1/verification`, {
      method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, redirect_url: 'capacitor://localhost/?screen=kyc' }),
    }));
    return { status: result.status, body: await result.json() };
  };
  try {
    for (partner of [false, true]) {
    for (business of [false, true]) {
      for (status of ['incomplete', 'awaiting_ubo', 'needs_ubos']) {
        calls = []; patches.length = 0;
        const response = await call(business ? 'kyb' : undefined);
        assert(response.status === 200 && response.body.success, JSON.stringify(response));
        assert(!response.body.data.tos_link_url, 'accepted terms must not reopen');
        const link = new URL(response.body.data.link_url);
        assert(link.searchParams.get('inquiry-id') === 'current', 'must return current inquiry');
        assert(new URL(link.searchParams.get('redirect-uri') || '').origin === appOrigin(), 'browser redirect must be public HTTPS');
        assert(calls.join(',') === 'GET /v0/customers/existing-customer,GET /v0/customers/existing-customer/kyc_link', 'must fetch current customer and current link');
        assert(patches.every(p => !p.bridge_customer_id || p.bridge_customer_id === 'existing-customer'), 'customer identity must remain stable');
        let opened = false;
        await openHostedVerification(link.href, { native: true, openBrowser: async options => { opened = options.presentationStyle === 'fullscreen'; }, navigateWeb: () => { throw new Error('native app must not navigate its WebView'); } });
        assert(opened, 'native verification must launch browser');
      }
      if (business) {
        calls = [];
        const terms = await call('terms');
        assert(terms.body.data.tos_accepted === true && calls.length === 1, 'accepted business terms must be acknowledged without reopening');
      } else {
        accepted = false; calls = [];
        const terms = await call();
        assert(terms.body.data.tos_link_url && !terms.body.data.link_url, 'unaccepted terms must precede individual KYC');
        assert(!calls.some(c => c.endsWith('/kyc_link')), 'must not open identity before terms');
        accepted = true; unavailable = true; calls = [];
        const failed = await call();
        assert(failed.status === 502 && calls.length === 1, 'provider failure must not create or return a stale customer link');
        unavailable = false;
      }
    }
    }
  } finally { globalThis.fetch = originalFetch; }
});
