/**
 * BorderPay pre-deposit review policy v2.4.
 * Advisory AI never overrides required evidence, account controls or a human-review flag.
 * This module does not grant bank-account access; the instruction endpoint must check
 * the persisted revision, policy version, evidence digest and approval expiry.
 */
export const POLICY_VERSION = "borderpay-predeposit-2.4.0";
export type Reason =
 | "invoice_incomplete" | "invalid_amount" | "buyer_details_missing"
 | "remitter_mismatch" | "individual_commercial_buyer" | "source_of_funds_missing"
 | "vague_description" | "fund_utilization_missing" | "agreement_missing"
 | "signature_missing" | "cross_border_context_missing" | "logistics_missing"
 | "business_proof_missing" | "end_use_missing" | "executed_contract_missing"
 | "government_buyer" | "jurisdiction_review" | "jurisdiction_policy_missing"
 | "possible_structuring" | "history_unavailable" | "evidence_unverified"
 | "contract_path_missing" | "contract_extraction_unavailable" | "contract_entity_mismatch" | "contract_value_mismatch" | "contract_scope_missing" | "contract_signatures_missing" | "contract_execution_unverified"
 | "receiving_account_invalid" | "gbp_b2b_only"
 | "order_source_missing" | "order_proof_missing" | "order_extraction_unavailable" | "order_mismatch" | "order_context_missing" | "fulfillment_proof_missing"
 | "manual_review_required" | "ai_unavailable" | "ai_flagged" | "document_classification_conflict";
export type DocumentKind = "signed_agreement" | "executed_contract" | "purchase_order"
 | "buyer_business_proof" | "end_use_declaration" | "logistics" | "source_of_funds"
 | "order_dashboard" | "platform_order_export" | "warehouse_receipt" | "dispatch_log";
export type Evidence = { id: string; kind: DocumentKind; sha256: string; };
export type Invoice = {
 id: string; revision: number; currency: "USD" | "EUR" | "GBP"; receiving_account_id: string;
 merchant: { legal_name: string; incorporation_country: string };
 buyer: { legal_name: string; type: "company" | "sole_proprietor" | "individual" | "government"; address: string; country: string; tax_id: string };
 remitter: { legal_name: string; type: "company" | "sole_proprietor" | "individual" | "government"; relationship: string };
 category: "digital_services" | "physical_goods";
 order_source: "direct_b2b" | "ecommerce" | "crm";
 order_platform: string; order_reference: string; tracking_numbers: string[];
 items: { description: string; quantity: number; unit_amount_minor: number; deliverable_reference: string }[];
 source_of_funds: string; fund_utilization: string;
 discovery_channel: string; cross_border_justification: string; commercial_end_use: string;
 contract_path: "generated" | "custom";
 agreement: { version: string; terms_sha256: string; signature_sha256: string; signed_by: string; signed_at: string; signature_consent: boolean };
 documents: Evidence[];
 instalments: { expected_count: number; commercial_reason: string };
};
export type ReviewContext = {
 // Must be loaded by the service, never accepted from the client payload.
 merchantUserId: string;
 receivingAccount: { id: string; owner_user_id: string; currency: string; status: string } | null;
 verifiedMerchant: { legal_name: string; incorporation_country: string; active: boolean; approved: boolean };
 jurisdictionPolicy: { version: string; review_countries: string[]; known_countries: string[] } | null;
 approvedAgreementVersions: string[];
 // A failed history lookup is distinct from zero earlier invoices.
 history: { available: boolean; buyer_invoice_count_30d: number; same_currency_total_minor_30d: number };
 // Compliance-configured review trigger, not a claimed regulatory threshold.
 structuring: { max_invoices_30d: number; aggregate_review_minor: Partial<Record<Invoice["currency"], number>> } | null;
 verifiedEvidenceHashes: string[];
 orderEvidence: OrderEvidence | null;
 contractEvidence: ContractEvidence | null;
 trackingVerifications: { number: string; status: "active" | "delivered" | "unverified" | "not_found"; checked_at: string; verified_by: "carrier_api" | "compliance" }[];
 now: string;
};
export type ContractEvidence = {
 document_sha256: string; extraction_status: "succeeded" | "pending" | "failed";
 confidence: number; seller_name: string; buyer_name: string; currency: string; total_minor: number;
 commercial_scope: string; seller_signature_present: boolean; buyer_signature_present: boolean;
 execution_verified: boolean; verification_source: "digital_signature_validation" | "compliance" | "unverified";
};
export function compareContractEvidence(invoice: Invoice,evidence:ContractEvidence):Reason[]{
 if(evidence.extraction_status!=="succeeded" || !Number.isFinite(evidence.confidence) || evidence.confidence<0.98 || evidence.confidence>1)return ["contract_extraction_unavailable"];
 const reasons:Reason[]=[];
 if(normalizedLegalName(evidence.seller_name)!==normalizedLegalName(invoice.merchant.legal_name)
  || normalizedLegalName(evidence.buyer_name)!==normalizedLegalName(invoice.buyer.legal_name)) reasons.push("contract_entity_mismatch");
 if(evidence.currency.trim().toUpperCase()!==invoice.currency || evidence.total_minor!==invoiceTotalMinor(invoice.items)) reasons.push("contract_value_mismatch");
 if(!meaningful(evidence.commercial_scope,40) || vague.test(evidence.commercial_scope.trim()))reasons.push("contract_scope_missing");
 if(!evidence.seller_signature_present || !evidence.buyer_signature_present)reasons.push("contract_signatures_missing");
 if(!evidence.execution_verified || !["digital_signature_validation","compliance"].includes(evidence.verification_source))reasons.push("contract_execution_unverified");
 return reasons;
}
export type OrderEvidence = {
 document_sha256: string; extraction_status: "succeeded" | "failed" | "pending";
 confidence: number; buyer_name: string; order_id: string; currency: string; total_minor: number;
 items: { description: string; quantity: number; unit_amount_minor: number }[];
 checkout_at: string; payment_status: string; fulfillment_status: string;
 order_history_present: boolean; ip_device_context_present: boolean;
};
export function compareOrderEvidence(invoice: Invoice, evidence: OrderEvidence, now: string): Reason[] {
 const reasons: Reason[]=[];
 if(evidence.extraction_status!=="succeeded" || !Number.isFinite(evidence.confidence) || evidence.confidence<0.98 || evidence.confidence>1) return ["order_extraction_unavailable"];
 const normalize=(s:string)=>s.normalize("NFKC").trim().replace(/\s+/gu," ");
 const expected=invoice.items.map(i=>({description:normalize(i.description),quantity:i.quantity,unit_amount_minor:i.unit_amount_minor}));
 const observed=evidence.items.map(i=>({description:normalize(i.description),quantity:i.quantity,unit_amount_minor:i.unit_amount_minor}));
 const sorted=(items:typeof expected)=>items.map(i=>JSON.stringify(i)).sort();
 if(normalizedLegalName(evidence.buyer_name)!==normalizedLegalName(invoice.buyer.legal_name)
  || evidence.order_id!==invoice.order_reference || evidence.currency.trim().toUpperCase()!==invoice.currency
  || evidence.total_minor!==invoiceTotalMinor(invoice.items)
  || invoiceTotalMinor(evidence.items)!==evidence.total_minor
  || JSON.stringify(sorted(expected))!==JSON.stringify(sorted(observed))) reasons.push("order_mismatch");
 const checked=Date.parse(evidence.checkout_at);
 if(!Number.isFinite(checked) || checked>Date.parse(now) || !meaningful(evidence.payment_status) || !meaningful(evidence.fulfillment_status)
  || !evidence.order_history_present || !evidence.ip_device_context_present) reasons.push("order_context_missing");
 return reasons;
}
export type AiFinding = { code: string; explanation: string; item_index?: number };
export type AiReview = {
 status: "passed" | "flagged" | "unavailable";
 findings: AiFinding[];
 provider_request_id: string | null;
 model: string;
 prompt_version: string;
 payload_sha256: string;
 physical_goods_detected: boolean;
};
export type Assessment = {
 policy_version: string;
 status: "action_required" | "review_required" | "ready_for_ai" | "approved";
 reasons: Reason[]; required_documents: DocumentKind[]; total_minor: number | null;
 cross_border: boolean; physical_goods: boolean; ai: AiReview | null;
};
const meaningful = (s: unknown, min = 1): s is string => typeof s === "string" && s.trim().length >= min;
const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
export const normalizedLegalName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("en-US");
const vague = /^(services?|consulting|consultancy|it|goods?|payment|invoice|miscellaneous|professional services|business services|software|other)[.!\s]*$/i;
export function invoiceTotalMinor(items: Pick<Invoice["items"][number], "quantity" | "unit_amount_minor">[]): number | null {
 if (!Array.isArray(items) || !items.length || items.length > 100) return null;
 let total = 0;
 for (const item of items) {
  if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !Number.isSafeInteger(item.unit_amount_minor) || item.unit_amount_minor <= 0) return null;
  const line = item.quantity * item.unit_amount_minor;
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) return null;
  total += line;
 }
 return total;
}
export function evaluateInvoice(invoice: Invoice, context: ReviewContext, ai: AiReview | null = null): Assessment {
 const actions = new Set<Reason>(); const review = new Set<Reason>(); const required = new Set<DocumentKind>(invoice.contract_path==="custom"?["executed_contract"]:["signed_agreement"]);
 const total = invoiceTotalMinor(invoice.items);
 const account=context.receivingAccount;
 if(!account || !meaningful(invoice.receiving_account_id) || account.id!==invoice.receiving_account_id
  || account.owner_user_id!==context.merchantUserId || account.currency!==invoice.currency || account.status!=="active")actions.add("receiving_account_invalid");
 if(invoice.currency==="GBP" && (invoice.buyer.type!=="company" || invoice.remitter.type!=="company"))actions.add("gbp_b2b_only");
 const country = invoice.buyer.country?.trim().toUpperCase();
 const merchantCountry = context.verifiedMerchant.incorporation_country.trim().toUpperCase();
 const crossBorder = country !== merchantCountry;
 const physical = invoice.category === "physical_goods" || ai?.physical_goods_detected === true;
 if (!context.verifiedMerchant.active || !context.verifiedMerchant.approved) actions.add("invoice_incomplete");
 if (!meaningful(invoice.id) || !Number.isSafeInteger(invoice.revision) || invoice.revision < 1
   || !["USD","EUR","GBP"].includes(invoice.currency)
   || !["digital_services","physical_goods"].includes(invoice.category)
   || normalizedLegalName(invoice.merchant.legal_name) !== normalizedLegalName(context.verifiedMerchant.legal_name)
   || invoice.merchant.incorporation_country.trim().toUpperCase() !== merchantCountry) actions.add("invoice_incomplete");
 if (total === null) actions.add("invalid_amount");
 if (!meaningful(invoice.buyer.legal_name,2) || !meaningful(invoice.buyer.address,8) || !/^[A-Z]{2}$/.test(country || "")
   || !meaningful(invoice.buyer.tax_id,2) || !["company","sole_proprietor","individual","government"].includes(invoice.buyer.type)) actions.add("buyer_details_missing");
 if (!meaningful(invoice.remitter.legal_name,2) || !meaningful(invoice.remitter.relationship,12)
   || normalizedLegalName(invoice.remitter.legal_name) !== normalizedLegalName(invoice.buyer.legal_name)
   || invoice.remitter.type !== invoice.buyer.type) { review.add("remitter_mismatch");required.add("executed_contract"); }
 if (invoice.buyer.type === "individual" || invoice.buyer.type === "sole_proprietor" || invoice.remitter.type === "individual") {
  review.add("individual_commercial_buyer");required.add("buyer_business_proof");required.add("executed_contract");required.add("end_use_declaration");
  if (!meaningful(invoice.commercial_end_use,30)) actions.add("end_use_missing");
 }
 if (!meaningful(invoice.source_of_funds,30)) actions.add("source_of_funds_missing");
 if (!meaningful(invoice.fund_utilization,30)) actions.add("fund_utilization_missing");
 if (invoice.items.some(item=>!meaningful(item.description,30) || vague.test(item.description.trim()) || !meaningful(item.deliverable_reference,3))) actions.add("vague_description");
 if (crossBorder && (!meaningful(invoice.discovery_channel,15) || !meaningful(invoice.cross_border_justification,40))) actions.add("cross_border_context_missing");
 if (physical) required.add("logistics");
 if (ai?.physical_goods_detected && invoice.category !== "physical_goods") review.add("document_classification_conflict");
 if (invoice.buyer.type === "government" || /\b(obec|municipality|municipal|town hall|city council)\b/i.test(invoice.buyer.legal_name)) {
  review.add("government_buyer");required.add("executed_contract");
 }
 if (!context.jurisdictionPolicy || !context.jurisdictionPolicy.known_countries.includes(country) || !context.jurisdictionPolicy.known_countries.includes(merchantCountry)) review.add("jurisdiction_policy_missing");
 else if ([country,merchantCountry].some(c=>context.jurisdictionPolicy!.review_countries.includes(c))) {
  review.add("jurisdiction_review"); required.add("executed_contract");
 }
 if(!["generated","custom"].includes(invoice.contract_path))actions.add("contract_path_missing");
 if(invoice.contract_path==="generated"){
  const agreement = invoice.agreement;
  if (!context.approvedAgreementVersions.includes(agreement.version) || !hash(agreement.terms_sha256)) actions.add("agreement_missing");
  const signedTime = Date.parse(agreement.signed_at);const now = Date.parse(context.now);
  if (!hash(agreement.signature_sha256) || !meaningful(agreement.signed_by,2) || !Number.isFinite(signedTime) || !Number.isFinite(now) || signedTime > now || agreement.signature_consent!==true) actions.add("signature_missing");
 }else if(invoice.contract_path==="custom"){
  const contract=invoice.documents.find(d=>d.kind==="executed_contract" && hash(d.sha256));
  if(!contract)actions.add("executed_contract_missing");
  else if(!context.contractEvidence || context.contractEvidence.document_sha256!==contract.sha256)review.add("contract_extraction_unavailable");
  else compareContractEvidence(invoice,context.contractEvidence).forEach(reason=>{
   if(["contract_entity_mismatch","contract_value_mismatch","contract_scope_missing","contract_signatures_missing"].includes(reason))actions.add(reason);
   else review.add(reason);
  });
 }
 if (!context.history.available || !context.structuring) review.add("history_unavailable");
 else {
  const threshold=context.structuring.aggregate_review_minor[invoice.currency];
  if (!Number.isSafeInteger(threshold) || Number(threshold)<=0 || !Number.isSafeInteger(context.structuring.max_invoices_30d) || context.structuring.max_invoices_30d<2
    || !Number.isSafeInteger(context.history.buyer_invoice_count_30d) || context.history.buyer_invoice_count_30d<0
    || !Number.isSafeInteger(context.history.same_currency_total_minor_30d) || context.history.same_currency_total_minor_30d<0) review.add("history_unavailable");
  else if (context.history.buyer_invoice_count_30d + 1 >= context.structuring.max_invoices_30d
    && context.history.same_currency_total_minor_30d + (total || 0) >= Number(threshold)) review.add("possible_structuring");
 }
 if (!Number.isSafeInteger(invoice.instalments.expected_count) || invoice.instalments.expected_count < 1) actions.add("invoice_incomplete");
 if (invoice.instalments.expected_count > 1) {review.add("possible_structuring");required.add("executed_contract");}
 const missing: Partial<Record<DocumentKind,Reason>> = {signed_agreement:"agreement_missing",executed_contract:"executed_contract_missing",logistics:"logistics_missing",warehouse_receipt:"fulfillment_proof_missing",order_dashboard:"order_proof_missing",buyer_business_proof:"business_proof_missing",end_use_declaration:"end_use_missing"};
 for (const kind of required) {
  const doc=invoice.documents.find(d=>d.kind===kind && hash(d.sha256) && meaningful(d.id));
  if (!doc) actions.add(missing[kind] || "evidence_unverified");
  else if (!context.verifiedEvidenceHashes.includes(doc.sha256)) review.add("evidence_unverified");
 }

 if (!["direct_b2b","ecommerce","crm"].includes(invoice.order_source)) actions.add("order_source_missing");
 if (invoice.order_source==="ecommerce" || invoice.order_source==="crm") {
  if(!meaningful(invoice.order_platform,2) || !meaningful(invoice.order_reference,2)) actions.add("order_source_missing");
  const proof=invoice.documents.find(d=>["order_dashboard","platform_order_export"].includes(d.kind) && hash(d.sha256));
  if(!proof){required.add("order_dashboard");actions.add("order_proof_missing");}
  else {
   if(!context.verifiedEvidenceHashes.includes(proof.sha256))review.add("evidence_unverified");
   if(!context.orderEvidence || context.orderEvidence.document_sha256!==proof.sha256) review.add("order_extraction_unavailable");
   else compareOrderEvidence(invoice,context.orderEvidence,context.now).forEach(reason=>review.add(reason));
  }
 }
 if(physical){
  const warehouse=invoice.documents.some(d=>["warehouse_receipt","dispatch_log"].includes(d.kind) && hash(d.sha256) && context.verifiedEvidenceHashes.includes(d.sha256));
  const tracking=context.trackingVerifications.some(t=>invoice.tracking_numbers.includes(t.number)
   && ["active","delivered"].includes(t.status) && ["carrier_api","compliance"].includes(t.verified_by)
   && Number.isFinite(Date.parse(t.checked_at)) && Date.parse(t.checked_at)<=Date.parse(context.now)
   && Date.parse(context.now)-Date.parse(t.checked_at)<=24*60*60*1000);
  if(!warehouse && !tracking){required.add("warehouse_receipt");actions.add("fulfillment_proof_missing");}
 }

 if (ai?.status === "unavailable") review.add("ai_unavailable");
 if (ai?.status === "flagged" || (ai?.findings.length || 0)>0) review.add("ai_flagged");
 const status = actions.size ? "action_required" : review.size ? "review_required" : !ai ? "ready_for_ai" : ai.status === "passed" ? "approved" : "review_required";
 return {policy_version:POLICY_VERSION,status,reasons:[...actions,...review],required_documents:[...required],total_minor:total,cross_border:crossBorder,physical_goods:physical,ai};
}
// Stable digest binds all merchant data, attachment hashes and server review context.
export function canonicalJson(value: unknown): string {
 if (value === null || typeof value !== "object") {
  const result = JSON.stringify(value);if(result === undefined)throw new Error("Unsupported canonical value");return result;
 }
 if (Array.isArray(value)) return "["+value.map(canonicalJson).join(",")+"]";
 return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalJson((value as Record<string,unknown>)[k])).join(",")+"}";
}
export async function sha256(value: Uint8Array | string): Promise<string> {
 const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as BufferSource))).map(b=>b.toString(16).padStart(2,"0")).join("");
}
export async function assessedDigest(invoice: Invoice, context: ReviewContext): Promise<string> {
 return sha256(canonicalJson({policy_version:POLICY_VERSION,invoice,context}));
}

/** Unknown/unconfigured modes require an operator; AI cannot select its own mode. */
export function applyInvoiceReviewMode(assessment:Assessment,mode:unknown):Assessment{
 if(mode==="automatic" || assessment.status!=="approved")return assessment;
 return {...assessment,status:"review_required",reasons:[...new Set<Reason>([...assessment.reasons,"manual_review_required"])]};
}
