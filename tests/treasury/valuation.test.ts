import { bridgeMidmarketRate, treasuryUsdTotal, treasuryBalanceHistory } from '../../supabase/functions/bridge-operator-readonly/valuation.ts';
import { balanceDays, valuationTotal } from '../../components/business/treasury/balance.ts';
const eq=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
const now=Date.parse('2026-09-18T12:00:00Z');
const wallet=(currency:string,balance:string,id=currency==='USDT'?'tron':'base')=>({id,currency,chain:id,balance_available:true,balances:[{currency,balance}]});
const rates={USDC:1,USDT:0.999,EURC:1.15};
Deno.test('USD total values all tokens and deduplicates shared Base asset rows',()=>{
 const wallets=[wallet('USDC','100'),wallet('USDT','100'),wallet('EURC','100')];
 eq(treasuryUsdTotal([...wallets,wallets[0]],true,rates),314.9);
 eq(treasuryUsdTotal(wallets,false,rates),null);
});
Deno.test('missing balance or positive-token FX never becomes a partial or zero total',()=>{
 eq(treasuryUsdTotal([wallet('EURC','100')],true,{...rates,EURC:null}),null);
 eq(treasuryUsdTotal([wallet('EURC','0'),wallet('USDC','100')],true,{...rates,EURC:null}),100);
 eq(treasuryUsdTotal([wallet('USDC','invalid')],true,rates),null);
 eq(treasuryUsdTotal([{...wallet('USDC','100'),balance_available:false}],true,rates),null);
});
Deno.test('FX accepts current Bridge midmarket response and rejects stale/invalid quotes',()=>{
 const payload={midmarket_rate:'1.15',updated_at:new Date(now).toISOString()};
 eq(bridgeMidmarketRate(payload,now),1.15);
 eq(bridgeMidmarketRate(payload,now+300001),null);
 eq(bridgeMidmarketRate({...payload,midmarket_rate:'NaN'},now),null);
 eq(bridgeMidmarketRate({...payload,updated_at:''},now),null);
});
Deno.test('history uses token balance after events, not gross receipts or transfer amounts',()=>{
 const event={id:'a',bridge_wallet_id:'base',currency:'USDC',available_balance:'24800.26',created_at:'2026-09-17T12:00:00Z',amount:'21620.14'};
 const result=treasuryBalanceHistory([wallet('USDC','24800.26')],[event],true,rates,now);
 eq(result.complete,true);eq(result.points[0].usd,24800.26);
 eq(treasuryBalanceHistory([wallet('USDC','24800.26')],[event],false,rates,now).complete,false);
 eq(treasuryBalanceHistory([wallet('USDC','25000')],[event],true,rates,now).complete,false);
});
Deno.test('history combines shared Base currencies without double counting and rejects invalid events',()=>{
 const events=[{id:'a',bridge_wallet_id:'base',currency:'USDC',available_balance:'100',created_at:'2026-09-17T10:00:00Z'}, {id:'b',bridge_wallet_id:'base',currency:'EURC',available_balance:'100',created_at:'2026-09-17T11:00:00Z'}];
 const wallets=[wallet('USDC','100'),wallet('EURC','100')];
 eq(treasuryBalanceHistory(wallets,events,true,rates,now).points.map(p=>p.usd),[100,215,215]);
 eq(treasuryBalanceHistory(wallets,[{...events[0],available_balance:'invalid'}],true,rates,now).complete,false);
});
Deno.test('daily balance carries balances forward, keeps current total independent, and suppresses partial history',()=>{
 const valuation={currency:'USD' as const,total:'215.00',as_of:new Date(now).toISOString(),history:{complete:true,points:[{at:'2026-09-17T10:00:00Z',usd:100},{at:'2026-09-18T10:00:00Z',usd:215}]}};
 eq(balanceDays(valuation,3).map(p=>p.value),[0,100,215]);eq(valuationTotal(valuation),215);
 eq(balanceDays({...valuation,history:{...valuation.history,complete:false}},3),[]);
 eq(valuationTotal({...valuation,total:null}),null);
});
