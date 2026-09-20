import {parseDraft} from "./predeposit-input.ts";
import {invoiceTotalMinor,type Invoice} from "./predeposit-policy.ts";
// An invoice copy carries commercial billing only; it does not authorize payment.
export function invoiceCopy(payload:unknown,merchant:Invoice["merchant"],id:string,revision:number):Invoice{
 const fields=parseDraft(payload);
 if(!merchant.legal_name?.trim()||!merchant.incorporation_country?.trim())throw Error("Business legal details are required for an invoice");
 if(!fields.buyer.legal_name||!fields.buyer.address||!/^[A-Z]{2}$/.test(fields.buyer.country))throw Error("Enter the buyer's legal name, billing address and country");
 if(fields.items.some(i=>!i.description.trim())||invoiceTotalMinor(fields.items)===null)throw Error("Enter item descriptions and valid amounts");
 if(fields.currency==="GBP"&&(fields.buyer.type!=="company"||fields.remitter.type!=="company"))throw Error("GBP invoices require a corporate buyer and corporate remitter");
 return {...fields,id,revision,merchant,documents:[],agreement:{version:"",terms_sha256:"",signature_sha256:"",signed_by:"",signed_at:"",signature_consent:false}};
}
