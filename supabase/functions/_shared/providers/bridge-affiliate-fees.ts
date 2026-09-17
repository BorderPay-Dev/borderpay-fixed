import { bridgeFetch } from './bridge-client.ts';
import type { LiveVa, FeeOverride } from '../affiliate-reward-sync.ts';
export function bridgeAffiliateFeeIO(db: any, customerId: string) {
 const path=(id:string)=>`/v0/customers/${encodeURIComponent(customerId)}/virtual_accounts/${encodeURIComponent(id)}`;
 return {
  read: async(id:string):Promise<LiveVa>=>{
   const r=await bridgeFetch({method:'GET',path:path(id)});
   if(!r.ok) throw new Error(`bridge_va_read_${r.status}`);
   const raw:any=(r.data as any)?.data??r.data;
   if(raw?.fee_config || raw?.developer_fee_percent==null) throw new Error('unsupported_provider_fee_configuration');
   if(raw.id!==id) throw new Error('provider_va_identity_mismatch');
   return {id,currency:String(raw.source?.currency||raw.currency||'').toUpperCase(),fee:Number(raw.developer_fee_percent),status:String(raw.status)};
  },
  update: async(id:string,fee:number)=>{
   const r=await bridgeFetch({method:'PUT',path:path(id),body:{developer_fee_percent:String(fee)},idempotencyKey:crypto.randomUUID()});
   if(!r.ok) throw new Error(`bridge_va_fee_update_${r.status}`);
   return {requestId:r.request_id||null};
  },
  save: async(row:FeeOverride)=>{
   const {error}=await db.from('affiliate_va_fee_overrides').upsert({...row,updated_at:new Date().toISOString()},{onConflict:'user_id,virtual_account_id'});
   if(error) throw new Error(error.message);
  },
 };
}
