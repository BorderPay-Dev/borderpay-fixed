export type AgreementType = "b2b" | "d2c" | "b2c";
export type ConsumerTerms = { delivery: string; cancellations_returns: string; support_contact: string; additional_charges: string };
export const AGREEMENT_LABELS: Record<AgreementType,string> = { b2b:"B2B commercial agreement", d2c:"D2C direct-to-consumer agreement", b2c:"B2C consumer sales agreement" };
export function agreementType(value: unknown): AgreementType {
 if(value===undefined||value===null)return "b2b";
 if(value==="b2b"||value==="d2c"||value==="b2c")return value;
 throw Error("Select B2B, D2C or B2C for this agreement");
}
export function isConsumerSale(value: unknown): boolean { return agreementType(value)!=="b2b"; }
export function agreementSaleError(invoice:{agreement_type?:unknown;currency:string;buyer:{type:string};remitter:{type:string}}):string|null {
 const type=agreementType(invoice.agreement_type);
 if(invoice.currency==="GBP"&&(type!=="b2b"||invoice.buyer.type!=="company"||invoice.remitter.type!=="company"))return "GBP invoices require a B2B agreement, corporate buyer and corporate remitter";
 if(type!=="b2b"&&invoice.buyer.type!=="individual")return "Select an individual consumer for D2C or B2C, or use B2B for a business buyer";
 return null;
}
export function assertAgreementSale(invoice:Parameters<typeof agreementSaleError>[0]) { const error=agreementSaleError(invoice);if(error)throw Error(error); }
export function assertTemplateType(template:{agreement_type?:unknown},invoice:{agreement_type?:unknown}){
 if(agreementType(template.agreement_type)!==agreementType(invoice.agreement_type))throw Error("Select an agreement template matching B2B, D2C or B2C");
}
export function consumerTermsComplete(terms?:ConsumerTerms):boolean {
 return !!terms&&Object.values(terms).length===4&&Object.values(terms).every(v=>typeof v==="string"&&v.trim().length>=3);
}
export function requireConsumerTerms(invoice:{agreement_type?:unknown;consumer_terms?:ConsumerTerms}){
 if(isConsumerSale(invoice.agreement_type)&&!consumerTermsComplete(invoice.consumer_terms))throw Error("Complete delivery, cancellation / return terms, customer support and additional charges for the consumer agreement");
}
export function isPlatformOrder(source:string){return source==="ecommerce"||source==="crm";}
