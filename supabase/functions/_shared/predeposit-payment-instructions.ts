import { assessedDigest, evaluateInvoice, invoiceTotalMinor, POLICY_VERSION, type Invoice, type ReviewContext } from "./predeposit-policy.ts";

export type ApprovedInvoiceRecord = {
 status: string; payload_sha256: string; policy_version: string;
 approval_expires_at: string; dossier_sha256: string;
};
export type ReceivingAccountDetails = {
 id: string; owner_user_id: string; currency: string; status: string;
 beneficiary_name: string; bank_name: string; account_number?: string; routing_number?: string;
 sort_code?: string; iban?: string; bic?: string; required_payment_reference?: string;
};
export type BankPaymentInstructions = {
 invoice_reference: string; account_id: string; currency: "USD"|"EUR"|"GBP"; amount: string;
 beneficiary_name: string; bank_name: string; account_number?: string; routing_number?: string;
 sort_code?: string; iban?: string; bic?: string; required_payment_reference?: string;
};
// Call only with authenticated user identity and freshly loaded server records.
// This function formats instructions; it never creates an account or initiates a transfer.
export async function generateBankPaymentInstructions(
 authenticatedUserId:string,invoice:Invoice,context:ReviewContext,
 approval:ApprovedInvoiceRecord,account:ReceivingAccountDetails,now:string=new Date().toISOString(),
):Promise<BankPaymentInstructions>{
 if(authenticatedUserId!==context.merchantUserId || account.owner_user_id!==authenticatedUserId
  || account.id!==invoice.receiving_account_id || account.id!==context.receivingAccount?.id
  || account.currency!==invoice.currency || account.status!=="active")throw Error("The selected receiving account is unavailable");
 const expires=Date.parse(approval.approval_expires_at);
 if(approval.status!=="approved" || approval.policy_version!==POLICY_VERSION
  || approval.payload_sha256!==await assessedDigest(invoice,context)
  || !/^[a-f0-9]{64}$/.test(approval.dossier_sha256)
  || !Number.isFinite(expires) || !Number.isFinite(Date.parse(now)) || expires<=Date.parse(now))throw Error("Current invoice approval is required");
 const assessment=evaluateInvoice(invoice,context);
 if(assessment.status==="action_required" || assessment.total_minor===null)throw Error("Invoice requirements are incomplete");
 return formatInstructions(invoice,account,assessment.total_minor);
}
// Observation mode supports existing merchants' invoicing without introducing an
// invoice-approval requirement. Financial access and live provider checks remain
// the caller's responsibility. Enforced mode must use the approved path above.
export function generateObservedInvoiceInstructions(owner:string,invoice:Invoice,account:ReceivingAccountDetails,mode:unknown):BankPaymentInstructions{
 if(mode!=="observe")throw Error("Invoice approval is required before bank details can be shared");
 if(account.owner_user_id!==owner||account.id!==invoice.receiving_account_id||account.currency!==invoice.currency||account.status!=="active")throw Error("The selected receiving account is unavailable");
 const total=invoiceTotalMinor(invoice.items);
 if(total===null)throw Error("Invoice amount is invalid");
 return formatInstructions(invoice,account,total);
}
function formatInstructions(invoice:Invoice,account:ReceivingAccountDetails,totalMinor:number):BankPaymentInstructions{
 // Preserve the strict GBP business-to-business rule even on a manually approved record.
 if(invoice.currency==="GBP" && (invoice.buyer.type!=="company" || invoice.remitter.type!=="company"))throw Error("GBP requires a corporate buyer and corporate remitter");
 if(!account.beneficiary_name?.trim() || !account.bank_name?.trim())throw Error("Verified bank details are incomplete");
 const result:BankPaymentInstructions={
  invoice_reference:invoice.id,account_id:account.id,currency:invoice.currency,
  amount:Math.trunc(totalMinor/100)+"."+String(totalMinor%100).padStart(2,"0"),
  beneficiary_name:account.beneficiary_name,bank_name:account.bank_name,
 };
 if(invoice.currency==="EUR"){
  if(!account.iban?.trim() || !account.bic?.trim())throw Error("EUR bank details are incomplete");
  result.iban=account.iban;result.bic=account.bic;
 }else{
  if(!account.account_number?.trim())throw Error("Bank account number is missing");
  result.account_number=account.account_number;
  if(invoice.currency==="GBP"){
   if(!account.sort_code || !/^\d{6}$/.test(account.sort_code.replace(/[ -]/g,"")))throw Error("GBP sort code is missing or invalid");
   result.sort_code=account.sort_code;
  }else{
   if(!account.routing_number || !/^\d{9}$/.test(account.routing_number))throw Error("USD routing number is missing or invalid");
   result.routing_number=account.routing_number;
  }
 }
 if(account.required_payment_reference)result.required_payment_reference=account.required_payment_reference;
 return result;
}
