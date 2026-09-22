import assert from 'node:assert/strict';
import { isReceivingOnlyPause } from '../utils/bridgeAccountStatus.ts';
import { getFinancialAccessBlock } from '../supabase/functions/_shared/account-access.ts';
import { isRecordedFraudHold, restrictionNotice } from '../supabase/functions/_shared/account-restriction-copy.ts';
import { render as renderBusiness } from '../supabase/functions/_shared/email-templates/business/account-suspended.ts';

Deno.test('limited workspace requires raw provider pause and no local hold',()=>{
 const p={account_status:'active',bridge_account_status:'paused',bridge_provider_account_status:'paused'};
 assert.equal(isReceivingOnlyPause(p),true);
 for(const patch of [
  {account_status:'frozen'}, {account_status:'suspended'}, {account_status:'closed'},
  {account_status:''}, {account_frozen_at:'2026-09-23'}, {bridge_provider_account_status:'closed'},
  {bridge_provider_account_status:undefined}
 ])assert.equal(isReceivingOnlyPause({...p,...patch}),false,JSON.stringify(patch));
});
Deno.test('paused provider, local holds, missing records and lookup errors block mutations',async()=>{
 const db=(data:any,error:any=null)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data,error})})})})});
 const active={account_status:'active',account_frozen_at:null,bridge_account_status:'active'};
 assert.equal(await getFinancialAccessBlock(db(active),'user'),null);
 for(const patch of [{bridge_account_status:'paused'},{account_status:'paused'},{account_status:'frozen'},{account_frozen_at:'2026-09-23'}]){
  assert.ok(await getFinancialAccessBlock(db({...active,...patch}),'user'));
 }
 assert.ok(await getFinancialAccessBlock(db(null),'user'));
 assert.ok(await getFinancialAccessBlock(db(null,{message:'unavailable'}),'user'));
});
Deno.test('fraud instructions require explicit recorded hold and do not promise automatic release',()=>{
 assert.equal(isRecordedFraudHold('Provider fraud alert hold — awaiting bank resolution'),true);
 assert.equal(isRecordedFraudHold('Fraud-related withdrawal hold: operator confirmation'),true);
 assert.equal(isRecordedFraudHold('No fraud reported'),false);
 const body=restrictionNotice('fraud_hold').paragraphs.join(' ');
 assert.match(body,/sending bank/);assert.match(body,/No-Fraud/);
 assert.match(body,/formally released/);assert.doesNotMatch(body,/automatically|only way/i);
});
Deno.test('receiving email uses held currencies and offers reviewed recovery rather than direct payments',()=>{
 const message=renderBusiness({restriction_kind:'receiving_paused',receiving_currencies:['EUR','EUR','XYZ']});
 assert.match(message.text,/EUR receiving accounts/);
 assert.doesNotMatch(message.text,/USD receiving|GBP receiving|XYZ/);
 assert.match(message.text,/request withdrawal of eligible/);
 assert.match(message.text,/Direct payments remain unavailable/);
 const fraud=renderBusiness({restriction_kind:'fraud_hold'});
 assert.match(fraud.text,/fraud-related hold/);
 assert.doesNotMatch(fraud.text,/You can request withdrawal/);
 const generic=renderBusiness();
 assert.doesNotMatch(generic.text,/You can request withdrawal/);
});
