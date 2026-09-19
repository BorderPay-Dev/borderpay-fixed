import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { bridgeProvider } from '../_shared/providers/bridge.ts';
import { bridgeAffiliateFeeIO } from '../_shared/providers/bridge-affiliate-fees.ts';
import { rewardWanted, syncVirtualAccountFee, type LiveVa, type FeeOverride } from '../_shared/affiliate-reward-sync.ts';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function equal(a: string, b: string) { if (!a || !b || a.length !== b.length) return false; let n = 0; for (let i=0;i<a.length;i++) n |= a.charCodeAt(i)^b.charCodeAt(i); return n===0; }
async function must<T>(result: { data: T; error: any }): Promise<T> { if (result.error) throw new Error(result.error.message); return result.data; }
async function syncOwner(userId: string) {
  const profile: any = await must(await db.from('user_profiles').select('id,account_type,bridge_customer_id').eq('id',userId).single());
  const business: any = profile.account_type==='business' ? await must(await db.from('business_profiles').select('bridge_customer_id').eq('user_id',userId).single()) : null;
  const customerId = business?.bridge_customer_id || profile.bridge_customer_id;
  if (!customerId || String(customerId).startsWith('demo_')) throw new Error('real_bridge_customer_required');
  const eligible = await must(await db.rpc('affiliate_member_eligible',{p_user_id:userId}));
  const member: any = await must(await db.from('affiliate_accounts').select('status').eq('user_id',userId).maybeSingle());
  const windows: any[] = (await must(await db.from('affiliate_fee_discounts').select('*').eq('referrer_user_id',userId).order('created_at'))) ?? [];
  const apply = rewardWanted(eligible===true && member?.status==='active',windows);
  const overrides: FeeOverride[] = (await must(await db.from('affiliate_va_fee_overrides').select('*').eq('user_id',userId))) ?? [];
  const listed = await bridgeProvider.listVirtualAccounts(customerId);
  const ids = new Set([...listed.filter(v=>['USD','EUR','GBP'].includes(v.currency.toUpperCase()) && ['active','activated'].includes(String(v.status))).map(v=>v.virtual_account_id), ...overrides.filter(v=>v.status!=='restored').map(v=>v.virtual_account_id)]);
  const io = bridgeAffiliateFeeIO(db,customerId);
  for (const id of ids) {
    const va = await io.read(id);
    const prior = overrides.find(o=>o.virtual_account_id===id);
    const applyToVa = apply && ['active','activated'].includes(va.status);
    await syncVirtualAccountFee(io,{userId,customerId,va,prior,apply:applyToVa});
    await must(await db.from('bridge_virtual_accounts').update({developer_fee_percent:applyToVa ? Math.min(va.fee,2.5) : prior ? prior.original_fee : va.fee,updated_at:new Date().toISOString()}).eq('bridge_customer_id',customerId).eq('bridge_virtual_account_id',id));
  }
  if (apply) {
    const stillEligible = await must(await db.rpc('affiliate_member_eligible',{p_user_id:userId}));
    if (stillEligible!==true) throw new Error('affiliate_eligibility_changed');
    for (const window of windows.filter(w=>w.status==='pending_provider')) {
      await must(await db.rpc('activate_b2b_affiliate_discount',{p_referral_id:window.referral_id,p_provider_confirmed:true}));
    }
  }
  await must(await db.from('affiliate_fee_discounts').update({status:'expired',updated_at:new Date().toISOString()}).eq('referrer_user_id',userId).in('status',['active','scheduled']).lte('ends_at',new Date().toISOString()));
  return {virtual_accounts_checked:ids.size, reward_applied:apply};
}
Deno.serve(async req=>{
  if(req.method!=='POST') return json({success:false,error:'POST only'},405);
  const configured = await db.rpc('app_config_get',{p_key:'worker_auth_token'});
  const bearer = (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(configured.error || !equal(bearer,String(configured.data||''))) return json({success:false,error:'Unauthorized'},401);
  const body = await req.json().catch(()=>({}));
  if(body.mode==='health') return json({success:true,mode:'health'});
  const claims: any[] = await must(await db.rpc('claim_affiliate_reward_sync',{p_limit:3}));
  const results=[];
  for(const claim of claims){
    try{
      const result=await syncOwner(claim.user_id);
      await must(await db.from('affiliate_reward_sync').update({lease_token:null,lease_until:null,next_attempt_at:new Date(Date.now()+60000).toISOString(),attempt_count:0,last_error:null,updated_at:new Date().toISOString()}).eq('user_id',claim.user_id).eq('lease_token',claim.lease_token));
      results.push({user_id:claim.user_id,success:true,...result});
    }catch(error){
      const message=error instanceof Error?error.message:'reward_sync_failed';
      await db.from('affiliate_reward_sync').update({lease_token:null,lease_until:null,next_attempt_at:new Date(Date.now()+300000).toISOString(),last_error:message.slice(0,300),updated_at:new Date().toISOString()}).eq('user_id',claim.user_id).eq('lease_token',claim.lease_token);
      results.push({user_id:claim.user_id,success:false,error:message});
    }
  }
  return json({success:true,processed:results.length,results});
});
