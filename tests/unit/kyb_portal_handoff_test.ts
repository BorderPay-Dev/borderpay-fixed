import { kybPortalHandoff } from '../../supabase/functions/_shared/kyb-portal-handoff.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw Error(message); }
const approved = { app_metadata: { kyb_synthetic_test: true } };
Deno.test('nonpilot users never call the KYB portal; user_metadata cannot opt in', async () => {
  let called = false; const fake = (() => { called = true; throw Error(); }) as typeof fetch;
  assert(await kybPortalHandoff({}, 'synthetic', fake) === null);
  assert(await kybPortalHandoff({ user_metadata: { kyb_synthetic_test: true } } as unknown as typeof approved, 'synthetic', fake) === null);
  assert(!called);
});
Deno.test('pilot forwards the authenticated token without accepting a client-selected identity', async () => {
 const fake = ((url: string, init: RequestInit) => { assert(url === 'https://kyb.borderpayvelocity.xyz/api/launch'); assert(new Headers(init.headers).get('Authorization') === 'Bearer synthetic'); assert(init.body === '{}'); assert(init.redirect === 'error');return Promise.resolve(Response.json({url:'https://kyb.borderpayvelocity.xyz/#launch=opaque',expiresAt:new Date(Date.now()+300000).toISOString()})); }) as typeof fetch;
 const result = await kybPortalHandoff(approved,'synthetic',fake);assert(result?.success === true);
});
Deno.test('errors and untrusted links do not fall back to creating a provider customer', async () => {
 for (const url of ['https://attacker.example/#launch=x','https://kyb.borderpayvelocity.xyz/?userId=other#launch=x','https://kyb.borderpayvelocity.xyz/staff#launch=x']) {
  const result=await kybPortalHandoff(approved,'synthetic',(()=>Promise.resolve(Response.json({url,expiresAt:new Date(Date.now()+300000).toISOString()}))) as typeof fetch);assert(result?.success===false);
 }
 const result=await kybPortalHandoff(approved,'synthetic',(()=>Promise.resolve(new Response('',{status:503}))) as typeof fetch);assert(result?.success===false);
});
