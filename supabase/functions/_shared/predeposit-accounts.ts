import { bridgeProvider } from "./providers/bridge.ts";
import { loadAndAssertBridgeIdentityInvariant } from "./bridge-identity-invariant.ts";
import { getFinancialAccessBlock } from "./account-access.ts";
import type { ReceivingAccountDetails } from "./predeposit-payment-instructions.ts";
export type MerchantAccounts={provider:"bridge"|"conduit"|"borderless";customer_id:string;merchant:{legal_name:string;incorporation_country:string;active:boolean;approved:boolean};accounts:ReceivingAccountDetails[]};
export async function loadInvoiceAccounts(db:any,userId:string):Promise<MerchantAccounts>{
 const block=await getFinancialAccessBlock(db,userId);if(block)throw Error("Account financial access is unavailable");
 const identity=await loadAndAssertBridgeIdentityInvariant(db,userId);
 if(!identity.ok || identity.context.account_type!=="business" || identity.context.verification_status!=="approved" || !identity.context.bridge_customer_id)throw Error("An approved business account is required");
 const {data:biz,error}=await db.from("business_profiles").select("company_name,country,status").eq("user_id",userId).single();
 if(error || !biz || biz.status!=="active")throw Error("Business account is not active");
 const profile=await bridgeProvider.getCustomerProfile(identity.context.bridge_customer_id);
 const raw:any=(profile.raw as any)?.data??profile.raw;
 if(String(raw?.status??"").toLowerCase()!=="active")throw Error("The receiving provider account is not active");
 const rows=await bridgeProvider.listVirtualAccounts(identity.context.bridge_customer_id);
 const holder=(currency:string,f:any)=> (currency==="GBP"
  ?[f.bank_beneficiary_name,f.account_holder_name,f.beneficiary_name,f.account_holder,f.account_name]
  :[f.account_holder_name,f.account_name,f.beneficiary_name,f.account_holder,f.bank_beneficiary_name])
  .find(v=>typeof v==="string" && v.trim())?.trim()||"";
 const accounts=rows.filter(r=>["USD","EUR","GBP"].includes(r.currency) && r.status==="active").map(r=>{
  const raw:any=r.account_details||{};const nested=raw.source_deposit_instructions;
  const selected=Array.isArray(nested)?nested.find((v:any)=>String(v.currency||"").toUpperCase()===r.currency):nested;
  const f={...raw,...(selected||{})};
  return {id:r.virtual_account_id,owner_user_id:userId,currency:r.currency,status:"active",
   beneficiary_name:holder(r.currency,f),bank_name:String(f.bank_name||""),
   account_number:String(f.bank_account_number||f.account_number||""),routing_number:String(f.bank_routing_number||f.routing_number||""),
   sort_code:String(f.bank_sort_code||f.sort_code||""),iban:String(f.iban||f.bank_iban||""),bic:String(f.bic||f.bank_bic||f.swift_bic||""),
   required_payment_reference:String(f.deposit_message||f.payment_reference||f.reference||"")};
 });
 return {provider:"bridge",customer_id:identity.context.bridge_customer_id,merchant:{legal_name:biz.company_name,incorporation_country:biz.country,active:true,approved:true},accounts};
}
// Conduit/Borderless adapters must implement this same contract and their own live
// eligibility/status checks. No provider is enabled or selected on a client's request.
