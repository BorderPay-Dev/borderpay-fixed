import { treasuryRequest } from '../../components/business/treasury/request.ts';
const base = {url:'https://example.invalid',key:'public',token:async()=>'test-session',body:{action:'snapshot'},timeoutMs:30};
Deno.test('slow response body is included in deadline', async () => {
  const r = await treasuryRequest({...base,fetcher:async()=>({ok:true,json:()=>new Promise(()=>{})}) as any});
  if(r.success || !r.error?.includes('refresh')) throw new Error('must time out');
});
Deno.test('auth acquisition is bounded before any request is sent', async () => {
  let sent=false;
  const r = await treasuryRequest({...base,token:()=>new Promise(()=>{}),fetcher:async()=>{sent=true;return new Response();}});
  if(r.success || sent) throw new Error('auth timeout must not send');
});
Deno.test('transfer network failure does not retry and communicates uncertainty', async () => {
  let calls=0;
  const r = await treasuryRequest({...base,body:{action:'transfer'},fetcher:async()=>{calls++;throw new Error('offline');}});
  if(calls!==1 || !r.error?.includes('could not be confirmed')) throw new Error('must not retry mutation');
});
Deno.test('missing session never falls back to anonymous treasury access', async () => {
  const r = await treasuryRequest({...base,token:async()=>null,fetcher:async()=>{throw new Error('should not call');}});
  if(r.success || !r.error?.includes('session')) throw new Error('session guard');
});
Deno.test('successful snapshot preserves provider payload', async () => {
  const r = await treasuryRequest<{refreshed_at:string}>({...base,fetcher:async()=>Response.json({success:true,data:{refreshed_at:'now'}})});
  if(!r.success || r.data?.refreshed_at!=='now') throw new Error('response not preserved');
});
