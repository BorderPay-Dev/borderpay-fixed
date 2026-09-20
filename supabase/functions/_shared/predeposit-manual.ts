import {z} from "npm:zod@3.25.76";
const text=z.string().trim().min(1).max(4000),sha=z.string().regex(/^[a-f0-9]{64}$/),amount=z.number().int().positive().safe();
const base={document_sha256:sha};
const order=z.object({...base,buyer_name:text,order_id:text,currency:z.enum(["USD","EUR","GBP"]),total_minor:amount,
 items:z.array(z.object({description:text,quantity:z.number().int().positive(),unit_amount_minor:amount})).min(1).max(100),
 checkout_at:z.string().datetime({offset:true}),payment_status:text,fulfillment_status:text,order_history_present:z.boolean(),ip_device_context_present:z.boolean()});
const contract=z.object({...base,seller_name:text,buyer_name:text,currency:z.enum(["USD","EUR","GBP"]),total_minor:amount,commercial_scope:text,seller_signature_present:z.boolean(),buyer_signature_present:z.boolean(),execution_verified:z.literal(true)});
export function manualEvidencePatch(kind:unknown,value:unknown,documents:{kind:string;sha256:string}[]){
 if(kind==="contract"){
  const v=contract.parse(value);
  if(!documents.some(d=>d.kind==="executed_contract"&&d.sha256===v.document_sha256))throw Error("Evidence hash does not match this contract");
  return {contractEvidence:{...v,confidence:1,extraction_status:"succeeded" as const,verification_source:"compliance" as const}};
 }
 if(kind==="order"){
  const v=order.parse(value);
  if(!documents.some(d=>["order_dashboard","platform_order_export"].includes(d.kind)&&d.sha256===v.document_sha256))throw Error("Evidence hash does not match this order proof");
  return {orderEvidence:{...v,confidence:1,extraction_status:"succeeded" as const}};
 }
 throw Error("Invalid evidence review kind");
}
