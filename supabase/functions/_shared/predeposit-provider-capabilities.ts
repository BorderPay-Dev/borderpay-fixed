export type CollectionEntitlement={
 provider:"bridge"|"conduit"|"borderless";environment:"sandbox"|"production";
 customer_id:string;account_id:string;currency:"USD"|"EUR"|"GBP";
 third_party_b2b:boolean;provider_approval_reference:string|null;
 enabled:boolean;expires_at:string|null;
};
/** An approved invoice is not permission to use an unsupported provider product. */
export function assertCollectionEntitlement(e:CollectionEntitlement,expected:{provider:string;environment:string;customer_id:string;account_id:string;currency:string},now=new Date().toISOString()){
 if(!e.enabled||e.provider!==expected.provider||e.environment!==expected.environment||e.customer_id!==expected.customer_id||e.account_id!==expected.account_id||e.currency!==expected.currency)throw Error("Receiving route is not enabled for this collection");
 if(!e.third_party_b2b||!e.provider_approval_reference?.trim())throw Error("Third-party business collections require confirmed provider permission");
 if(e.expires_at&&(!Number.isFinite(Date.parse(e.expires_at))||Date.parse(e.expires_at)<=Date.parse(now)))throw Error("Collection permission has expired");
}
export function assertNoComplianceBypass(source:{borderpay_status:string;provider_status:string},destination:{approved:boolean;active:boolean;compliance_case_resolved:boolean}){
 if(source.borderpay_status!=="active"||["paused","frozen","suspended","rejected","under_review"].includes(source.provider_status)||!destination.approved||!destination.active||!destination.compliance_case_resolved)throw Error("Provider review must be resolved before changing a collection route");
}
