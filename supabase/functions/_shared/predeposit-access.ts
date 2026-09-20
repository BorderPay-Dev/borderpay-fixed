/** Shared read boundary for receiving bank instructions; never used to alter a payment. */
export function redactBankCoordinates(value:unknown):unknown{
 if(Array.isArray(value))return value.map(redactBankCoordinates);
 if(!value||typeof value!=="object")return value;
 const blocked=new Set(["account_details","source_deposit_instructions","deposit_instructions","bank_account_number","account_number","virtual_account_number","bank_routing_number","routing_number","sort_code","bank_sort_code","iban","bank_iban","bic","bank_bic","swift_bic","payment_instructions_url","paymentInstructionsUrl","account_letter_url","accountLetterUrl","account_letter","accountNumber","routingNumber","sortCode","depositInstructions"]);
 return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,blocked.has(k)?null:redactBankCoordinates(v)]));
}
export async function requiresInvoiceInstructions(db:any,userId:string|null):Promise<boolean>{
 const {data,error}=await db.rpc("predeposit_requires_invoice_for_owner",{p_user_id:userId});
 if(error||typeof data!=="boolean")throw Error("Receiving instruction policy is unavailable");
 return data;
}
