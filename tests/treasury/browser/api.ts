// Browser test fixture only; production entry never imports this module.
const address = '0x0000000000000000000000000000000000000001';
const snapshot = {
 source:'bridge_production_live', access_mode:'read_only', account:{name:'BorderPay Africa, Inc.', customer_id:'fixture',status:'active'},refreshed_at:new Date().toISOString(),
 activity_history_complete:true,
 wallets_available:true,transfers_available:true,virtual_accounts_available:true,external_accounts_available:true,profile_available:true,
 wallets:['USDC','USDT','EURC'].map((currency,i)=>({id:i===1?'tron':'base',currency,chain:i===1?'tron':'base',address,status:'active',balance_available:true,balances:[{currency,chain:i===1?'tron':'base',balance:['128420.50','3480.20','8217.45'][i]}]})),
 virtual_accounts:['USD','EUR','GBP'].map(currency=>({id:currency,currency,rail:currency==='GBP'?'faster_payments':currency==='EUR'?'sepa':'ach',status:'active',account_holder_name:'BorderPay Africa, Inc.',bank_name:'Example Bank',bank_address:'1 Example Street',account_number:'12345678',routing_number:currency==='USD'?'123456789':'',sort_code:currency==='GBP'?'040075':'',iban:currency==='EUR'?'DE00123456789012345678':'',bic:'EXAMPLE1'})),
 external_accounts:[{id:'bank',currency:'GBP',rail:'faster_payments',status:'active',account_owner_name:'BorderPay Africa',bank_name:'Example Bank',last_4:'5678'}],
 transactions:Array.from({length:7},(_,i)=>({id:`fixture-transfer-${i}`,state:i===0?'payment_submitted':i===1?'refunded':'payment_processed',source:{currency:'USDC',payment_rail:'bridge_wallet',amount:String(1000+i*250)},destination:{currency:'GBP',payment_rail:'faster_payments',amount:String(700+i*180)},created_at:new Date(Date.now()-i*86400000).toISOString(),updated_at:new Date(Date.now()-i*86400000).toISOString()})),
};
export const treasuryAPI = {
 getSnapshot:async()=>{const w=window as any;w.reads=(w.reads||0)+1;await new Promise(r=>setTimeout(r,w.readDelay||30));return w.failRead ? {success:false,error:'Fixture refresh unavailable'}:{success:true,data:{...snapshot,activity_history_complete:!w.partialHistory}};},
 send:async(input:any)=>{const w=window as any;w.sends=(w.sends||0)+1;w.lastTransfer=input;await new Promise(r=>setTimeout(r,100));return {success:true,data:{transfer_id:'fixture-send',state:'payment_submitted'}};},
};
