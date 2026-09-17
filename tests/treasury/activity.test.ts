import { activityAmount, volumeSeries } from '../../components/business/treasury/activity.ts';
import { normalizeTreasuryActivity, mergeTreasuryActivity, readActivityPages } from '../../supabase/functions/bridge-operator-readonly/activity.ts';
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const now = Date.parse('2026-09-17T12:00:00Z');
const transfer = (overrides: any = {}) => ({ id:'transfer', state:'payment_processed', amount:'20.50', source:{currency:'usdc',payment_rail:'bridge_wallet'}, destination:{currency:'eurc',payment_rail:'base'}, receipt:{final_amount:'18.25'}, created_at:'2026-09-17T01:00:00Z', ...overrides });
Deno.test('volume retains source/destination units, uses receipts, never assumes missing amounts', () => {
 const row = normalizeTreasuryActivity(transfer(), 'transfer');
 eq(activityAmount(row, 'USDC'),20.5); eq(activityAmount(row, 'EURC'),18.25); eq(activityAmount(row, 'USD'),null);
 const missing = normalizeTreasuryActivity(transfer({receipt:{}}),'transfer');
 eq(activityAmount(missing,'EURC'),null); eq(volumeSeries([missing],'EURC','1W',now).excluded,1);
});
Deno.test('same token volume is counted once and failed/pending/refunded are excluded', () => {
 const row = normalizeTreasuryActivity(transfer({destination:{currency:'usdc',amount:'20'}}),'transfer');
 eq(activityAmount(row,'USDC'),20.5);
 for (const state of ['refunded','returned','failed','payment_submitted','in_review']) eq(activityAmount({...row,state},'USDC'),null);
 eq(volumeSeries([row,row],'USDC','1W',now).total,20.5);
});
Deno.test('UTC windows include boundary, exclude future and invalid dates, calculate previous period', () => {
 const rows = ['2026-09-11T00:00:00Z','2026-09-10T23:59:59Z','2026-09-17T13:00:00Z','invalid'].map((created_at,i)=>normalizeTreasuryActivity(transfer({id:String(i),created_at}),'transfer'));
 const series=volumeSeries(rows,'USDC','1W',now);
 eq(series.days.length,7); eq(series.total,20.5); eq(series.previous,20.5); eq(series.rows.length,1); eq(series.days[0].count,1);
});
Deno.test('VA lifecycle collapses by deposit, normalizes type, refunds remove completed volume', () => {
 const event=(id:string,type:string,created_at:string)=>normalizeTreasuryActivity({id,type,deposit_id:'deposit',currency:'eur',amount:'999',receipt:{initial_amount:'100'},created_at},'virtual_account');
 const received=event('1','funds_received','2026-09-16T01:00:00Z');
 const processed=event('2','payment_processed','2026-09-17T01:00:00Z');
 eq(mergeTreasuryActivity([received,processed]).length,1);
 eq(activityAmount(processed,'EUR'),100); eq(activityAmount(processed,'USDC'),null);
 const refund=event('3','refund','2026-09-17T02:00:00Z');
 eq(volumeSeries(mergeTreasuryActivity([processed,received,refund]),'EUR','1W',now).total,0);
 eq(mergeTreasuryActivity([event('4','activation','2026-09-17T03:00:00Z')]).length,0);
});
Deno.test('history pagination follows older cursor; complete requires exhaustion', async () => {
 const calls: unknown[]=[];
 const result=await readActivityPages(async cursor=>{calls.push(cursor); return {ok:true,data:{data: cursor ? [{id:'last',customer_id:'owner'}] : Array.from({length:100},(_,i)=>({id:String(i),on_behalf_of:'owner'}))}};},'owner');
 eq(calls,[undefined,'99']); eq(result.rows.length,101); eq(result.complete,true);
});
Deno.test('history caps, repeated pages and later failure explicitly report partial data', async () => {
 const data={data:Array.from({length:100},(_,i)=>({id:String(i)}))};
 eq((await readActivityPages(async()=>({ok:true,data}),'owner',1)).complete,false);
 const repeat=await readActivityPages(async()=>({ok:true,data}),'owner'); eq(repeat.rows.length,100); eq(repeat.complete,false);
 const fail=await readActivityPages(async cursor=>cursor?{ok:false}:{ok:true,data},'owner'); eq(fail.rows.length,100); eq(fail.complete,false);
});
Deno.test('wrong owner or invalid list cannot be used as treasury history', async () => {
 for (const data of [{data:[{id:'1',on_behalf_of:'other'}]}, {data:[{id:'2',customer_id:'other'}]}, {message:'unexpected'}]) {
  let rejected=false; try {await readActivityPages(async()=>({ok:true,data}),'owner');}catch{rejected=true;} eq(rejected,true);
 }
});
