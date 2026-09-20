import { render } from '../supabase/functions/_shared/email-templates/partner/application-decision.ts';
import { deliverPartnerDecisionEmail } from '../supabase/functions/_shared/partner-decision-email.ts';
const assert=(v:unknown)=>{if(!v)throw Error('Assertion failed');};
const saved={review_id:'review-1',organization_id:'org',application_id:'app',recipient:'partner@example.com',partner_name:'Example Limited',decision:'approved',notes:'Please review your onboarding checklist.',tenant_id:null};
Deno.test('all five decisions have distinct, escaped HTML and text with portal CTA',()=>{
 for(const decision of ['under_review','approved','rejected','suspended','more_information'] as const){
  const email=render({company_name:'Example <script>',decision,notes:'First item\nSecond <img src=x onerror=alert(1)>',review_id:'review-1'});
  assert(email.subject && email.text.includes('Second') && email.html.includes('&lt;img'));
  assert(!email.html.includes('<script>') && !email.html.includes('<img src=x'));
  const portal='https://portal.borderpayafrica.com/';
  const links=Array.from(email.html.matchAll(/href="([^"]+)"/g),m=>m[1]);
  assert(links.some(link=>new URL(link).href===portal));
  const textLinks=email.text.split(/\s+/).filter(word=>word.startsWith('https:'));
  assert(textLinks.some(link=>new URL(link).href===portal));
  if(decision==='approved') assert(email.text.includes('Production access is enabled separately'));
  if(decision==='more_information') assert(email.text.includes('submit it again'));
 }
});
Deno.test('unknown decisions and unsaved review details cannot render',()=>{
 for(const p of [{decision:'invalid'}, {review_id:''}, {notes:''}]){
  let failed=false;try{render({company_name:'Example',decision:'approved',review_id:'review',notes:'Notes',...p} as any);}catch{failed=true;}assert(failed);
 }
});
Deno.test('delivery uses the saved recipient, decision and stable review idempotency key',async()=>{
 const bodies:any[]=[];
 const fetcher:typeof fetch=async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({success:true,data:{status:'sent',log_id:'log'}}));};
 for(let i=0;i<2;i++)assert((await deliverPartnerDecisionEmail(saved,{url:'https://example.test',token:'internal',fetcher})).status==='sent');
 assert(bodies.every(b=>b.to===saved.recipient && b.props.notes===saved.notes && b.idempotency_key==='partner-decision:review-1'));
});
Deno.test('provider rejection, pending response and transport uncertainty are never reported as sent',async()=>{
 for(const [response,status] of [[{success:false,error:'Failed'},'failed'],[{success:true,data:{status:'sending'}},'pending'],[{success:true,data:{status:'failed'}},'failed']] as const){
  const result=await deliverPartnerDecisionEmail(saved,{url:'https://example.test',token:'internal',fetcher:async()=>new Response(JSON.stringify(response))});assert(result.status===status);
 }
 assert((await deliverPartnerDecisionEmail(saved,{url:'https://example.test',token:'internal',fetcher:async()=>{throw Error('network');}})).status==='unknown');
});
Deno.test('unsupported decisions do not send email and missing dispatcher is reported',async()=>{
 assert((await deliverPartnerDecisionEmail({...saved,decision:'invalid'},{url:'',token:'',fetcher:async()=>{throw Error('unexpected send');}})).status==='failed');
 assert((await deliverPartnerDecisionEmail(saved,{url:'',token:''})).status==='failed');
});
