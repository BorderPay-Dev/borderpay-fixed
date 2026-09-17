import {renderTemplate} from '../supabase/functions/_shared/email-templates/index.ts';
import { rewardWanted, syncVirtualAccountFee, type FeeOverride } from '../supabase/functions/_shared/affiliate-reward-sync.ts';
function assert(ok:unknown,reason='assertion failed'){if(!ok)throw new Error(reason)}
async function rejects(f:()=>Promise<unknown>){let rejected=false;try{await f()}catch{rejected=true}assert(rejected)}
const base={id:'va',currency:'EUR',fee:2.98,status:'active'};
const input={userId:'owner',customerId:'customer',va:base,apply:true};
function mock(){let fee=2.98;const writes:FeeOverride[]=[];const updates:number[]=[];return {writes,updates,io:{read:async()=>({...base,fee}),update:async(_id:string,next:number)=>{assert(writes.length>0,'must save original before changing fee');fee=next;updates.push(next);return {requestId:'request'}},save:async(row:FeeOverride)=>{writes.push({...row})}}}}
Deno.test('reward applies after persisting original and provider confirmation',async()=>{const m=mock();await syncVirtualAccountFee(m.io,input);assert(m.updates[0]===2.5);assert(m.writes.at(-1)?.status==='applied');assert(m.writes[0].original_fee===2.98)});
Deno.test('expiry restores the exact original rate',async()=>{const m=mock();await syncVirtualAccountFee(m.io,input);await syncVirtualAccountFee(m.io,{...input,va:{...base,fee:2.5},prior:m.writes.at(-1),apply:false});assert(m.updates[1]===2.98);assert(m.writes.at(-1)?.status==='restored')});
Deno.test('repeated synchronization does not update the provider twice',async()=>{const m=mock();await syncVirtualAccountFee(m.io,input);await syncVirtualAccountFee(m.io,{...input,va:{...base,fee:2.5},prior:m.writes.at(-1)});assert(m.updates.length===1)});
Deno.test('lower and fee-exempt accounts never get a fee increase',async()=>{for(const fee of [0,1,2,2.5]){const m=mock();await syncVirtualAccountFee(m.io,{...input,va:{...base,fee}});assert(m.updates.length===0&&m.writes.length===0)}});
Deno.test('separate provider pricing changes are preserved for review',async()=>{const m=mock();await syncVirtualAccountFee(m.io,input);await rejects(()=>syncVirtualAccountFee(m.io,{...input,va:{...base,fee:1.5},prior:m.writes.at(-1),apply:false}));assert(m.updates.length===1);assert(m.writes.at(-1)?.status==='conflict')});
Deno.test('provider success with wrong readback cannot activate a reward',async()=>{const m=mock();m.io.read=async()=>({...base,fee:2.98});await rejects(()=>syncVirtualAccountFee(m.io,input));assert(!m.writes.some(x=>x.status==='applied'))});
Deno.test('retry after provider change but before database confirmation recovers safely',async()=>{const m=mock();await syncVirtualAccountFee(m.io,input);await syncVirtualAccountFee(m.io,{...input,va:{...base,fee:2.5},prior:{...m.writes[0],status:'apply_pending'}});assert(m.updates.length===1);assert(m.writes.at(-1)?.status==='applied')});
Deno.test('reward eligibility and expiry are server-time bounded',()=>{const window={status:'active',starts_at:'2026-09-01',ends_at:'2026-10-01'};assert(rewardWanted(true,[window],Date.parse('2026-09-17')));assert(!rewardWanted(false,[window],Date.parse('2026-09-17')));assert(!rewardWanted(true,[window],Date.parse('2026-10-01')));assert(!rewardWanted(true,[{...window,status:'revoked'}],Date.parse('2026-09-17')))});

Deno.test('affiliate emails describe fee rewards without cash awards or misleading percentages',()=>{
 for(const template of ['business.affiliate_program','individual.affiliate_program'] as const){
 const rendered=renderTemplate(template,{company_name:'<Test>'});
 assert(rendered.text.includes('30 days')&&rendered.text.includes('business completes verification'));
 assert(!rendered.text.includes('30%')&&!rendered.text.includes('2.5')&&!rendered.text.includes('$100'));
 assert(rendered.html.includes('&lt;Test&gt;'));
 }
});
