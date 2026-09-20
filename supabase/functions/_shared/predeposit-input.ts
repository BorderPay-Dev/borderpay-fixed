import { z } from "npm:zod@3.25.76";
const text=(max=2000)=>z.string().trim().max(max);
const type=z.enum(["company","sole_proprietor","individual","government"]);
export const draftSchema=z.object({
 currency:z.enum(["USD","EUR","GBP"]),receiving_account_id:text(200),
 buyer:z.object({legal_name:text(300),type,address:text(1200),country:text(2),tax_id:text(100)}),
 remitter:z.object({legal_name:text(300),type,relationship:text()}),
 category:z.enum(["digital_services","physical_goods"]),
 order_source:z.enum(["direct_b2b","ecommerce","crm"]),order_platform:text(200),order_reference:text(200),
 tracking_numbers:z.array(text(200)).max(20),
 items:z.array(z.object({description:text(2000),quantity:z.number().int().positive().max(1000000),unit_amount_minor:z.number().int().positive().max(9007199254740991),deliverable_reference:text(300)})).min(1).max(100),
 source_of_funds:text(6000),fund_utilization:text(6000),discovery_channel:text(),cross_border_justification:text(6000),commercial_end_use:text(6000),
 contract_path:z.enum(["generated","custom"]),agreement_version:text(200),
 signature_consent:z.boolean(),document_ids:z.array(z.string().uuid()).max(30),
 instalments:z.object({expected_count:z.number().int().min(1).max(100),commercial_reason:text(4000)}),
});
export function parseDraft(value:unknown){
 const result=draftSchema.safeParse(value);if(result.success)return result.data;
 const labels:Record<string,string>={currency:"invoice currency",receiving_account_id:"receiving account",buyer:"buyer details",remitter:"sender details",legal_name:"legal name",address:"billing address",country:"country (2-letter code)",tax_id:"tax / registration ID",type:"entity type",relationship:"commercial relationship",category:"goods or services category",order_source:"order source",order_platform:"platform name",order_reference:"order reference",tracking_numbers:"tracking numbers",description:"description",quantity:"quantity (whole number greater than zero)",unit_amount_minor:"unit price (greater than zero)",deliverable_reference:"delivery reference",source_of_funds:"source of funds",fund_utilization:"use of funds",discovery_channel:"buyer discovery channel",cross_border_justification:"international sourcing reason",commercial_end_use:"commercial end use",contract_path:"contract workflow",agreement_version:"agreement template",signature_consent:"signature authorization",document_ids:"supporting documents",expected_count:"number of payments",commercial_reason:"installment reason"};
 const fields=[...new Set(result.error.issues.map(issue=>{
  const path=issue.path;
  if(path[0]==="items")return typeof path[1]==="number"?"item "+(path[1]+1)+" "+(labels[String(path[2])]||"details"):"at least one invoice item";
  return path.map(p=>typeof p==="number"?"":labels[String(p)]||"form details").filter(Boolean).join(" — ")||"invoice details";
 }))];
 throw Error("Invoice form is incomplete. Please check "+fields[0]+". Then try again.");
}
export const EVIDENCE_KINDS=["merchant_invoice","executed_contract","purchase_order","buyer_business_proof","end_use_declaration","logistics","source_of_funds","order_dashboard","platform_order_export","warehouse_receipt","dispatch_log","logo","signature"] as const;
export function exactMinor(value:string):number{
 if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error("Use an amount with at most two decimal places");
 const [whole,cents=""]=value.split(".");const result=BigInt(whole)*100n+BigInt(cents.padEnd(2,"0"));
 if(result<=0n || result>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Amount is outside supported range");return Number(result);
}
