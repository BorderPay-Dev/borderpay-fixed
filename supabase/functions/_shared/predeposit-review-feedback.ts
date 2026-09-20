/** Merchant-facing automated corrections; audit reasons and evidence remain unchanged. */
export function automatedReviewFeedback(assessment:any,mode:unknown){
 const original={merchant_feedback:assessment?.merchant_feedback||"",reasons:assessment?.reasons||[],findings:assessment?.ai?.findings||[]};
 if(mode!=="automatic")return original;
 const corrections:Record<string,string>={
  invoice_incomplete:"Complete the invoice fields using your verified business details.",
  invalid_amount:"Enter valid quantities and amounts, then check the invoice total.",
  buyer_details_missing:"Add the buyer's legal name, billing address, country and tax ID.",
  remitter_mismatch:"Confirm who will pay and provide a signed agreement explaining any difference between the buyer and sender.",
  individual_commercial_buyer:"Provide the buyer's business registration, signed agreement and commercial end-use declaration.",
  source_of_funds_missing:"Explain the actual source of the buyer's payment funds.",
  vague_description:"Describe the specific goods or services, quantities, deliverables and order references.",
  fund_utilization_missing:"Explain how your business will use the payment.",
  agreement_missing:"Select the approved agreement template and generate the signed agreement.",
  signature_missing:"Add your signature and authorize its use for this agreement.",
  cross_border_context_missing:"Explain how the buyer found your business and why this purchase is being made across borders.",
  logistics_missing:"Attach logistics or possession evidence for the goods listed.",
  business_proof_missing:"Attach the buyer's business registration or tax evidence.",
  end_use_missing:"Add a commercial end-use declaration explaining how the goods will be used.",
  executed_contract_missing:"Attach the executed contract or statement of work for this order.",
  government_buyer:"Provide the public entity's purchase order and executed contract; this transaction has not passed automated checks.",
  jurisdiction_review:"The declared jurisdictions triggered a review rule. This document package has not passed automated checks.",
  jurisdiction_policy_missing:"Jurisdiction checks could not be completed. Try again later; your normal receiving-account access is unchanged.",
  possible_structuring:"Explain the genuine commercial reason for instalments or related invoices and attach the supporting contract.",
  history_unavailable:"Transaction-history checks could not be completed. Try again later.",
  evidence_unverified:"The source or authenticity of uploaded evidence could not be independently verified. A readable scan alone does not establish authenticity.",
  contract_path_missing:"Choose a generated agreement or upload your existing contract.",
  contract_extraction_unavailable:"Contract details could not be read reliably. Upload a clear, complete PDF with readable parties, values, scope and execution details.",
  contract_entity_mismatch:"The buyer or seller on the contract differs from the invoice. Check the actual contracting parties and correct the inconsistent document.",
  contract_value_mismatch:"The contract amount or currency differs from the invoice. Correct the discrepancy or provide the agreement covering this payment.",
  contract_scope_missing:"Use a contract that clearly describes the actual commercial scope and deliverables.",
  contract_signatures_missing:"Provide the contract with the required parties' execution signatures.",
  contract_execution_unverified:"A visible signature does not verify its signer. Contract execution remains unverified; Azure cannot certify it from a scan.",
  receiving_account_invalid:"Select an active receiving account matching the invoice currency.",
  gbp_b2b_only:"GBP requires a corporate buyer paying from its corporate account.",
  order_source_missing:"Select the order source and provide the platform name and order reference where applicable.",
  order_proof_missing:"Attach the relevant store or CRM order record or official export.",
  order_extraction_unavailable:"Order details could not be read reliably. Upload a clear, complete order record.",
  order_mismatch:"The order record and invoice differ. Check the buyer, reference, items, amount and currency against the actual order.",
  order_context_missing:"Include order history, checkout time, payment and fulfillment status, and available IP/device context.",
  fulfillment_proof_missing:"Attach fulfillment or dispatch evidence. A typed tracking number alone does not establish that a shipment is active.",
  ai_unavailable:"Automated document checks are temporarily unavailable. Try again later; this is not a finding that your document is false.",
  ai_flagged:"Review the specific findings below, correct the paperwork and submit a new revision.",
  document_classification_conflict:"The descriptions appear to include physical goods. Check the category and add the relevant logistics evidence.",
  policy_changed:"Check the current requirements and submit a new invoice revision.",
  screening_unavailable:"Document checks could not finish. Try again later; your normal receiving-account access is unchanged.",
  manual_review_required:"Resubmit this invoice under the current automatic review settings.",
 };
 const findings=[...original.findings,...original.reasons.map((code:string)=>({code,explanation:corrections[code]||"Check the supporting details for: "+String(code).replace(/_/g," ")+". Submit a corrected revision."}))];
 if(assessment?.checks_not_performed?.length)findings.push({code:"document_review_scope",explanation:"This result covers document checks only. Jurisdiction clearance and threshold-based transaction screening were not performed by this review. Your existing banking controls still apply."});
 const passed=assessment?.status==="approved";
 return {merchant_feedback:original.merchant_feedback||(passed
  ?"Automated document checks passed. This does not certify authenticity, legal validity or bank acceptance."
  :findings.length?"Automated checks found items to address. Review the details below and submit an updated revision. Your invoice remains available to download."
  :"Automated document review is processing."),
  reasons:[],findings};
}
