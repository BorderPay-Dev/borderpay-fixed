import {pdf} from "./predeposit-self-test.ts";
import {loadEvidenceOcrConfig,startEvidenceOcr,pollEvidenceOcr} from "./predeposit-evidence-ocr.ts";
import {loadInvoiceAiConfig} from "./predeposit-ai-config.ts";
import {reviewDocumentPair,type ReadDocument} from "./predeposit-document-comparison.ts";
/** Sends synthetic documents to Azure; no merchant records, storage or payments are written. */
export async function runDocumentPairSelfTest(db:any){
 const config=await loadEvidenceOcrConfig(db);
 async function read(lines:string[]):Promise<ReadDocument>{
  const job=await startEvidenceOcr(pdf(lines),"application/pdf",config);if(job.status!=="pending")throw Error("Synthetic OCR could not start");
  const until=Date.now()+60000;
  do{const result=await pollEvidenceOcr(job,config);if(result.status==="succeeded")return result;if(result.status==="failed")throw Error("Synthetic OCR failed");await new Promise(r=>setTimeout(r,1500));}while(Date.now()<until);
  throw Error("Synthetic OCR timed out");
 }
 const common=["Seller: Example Merchant Ltd","Buyer: Example Buyer Ltd","Currency: GBP","Enterprise software subscription September 2026 for ten seats"];
 const [invoice,contract]=await Promise.all([
  read(["SYNTHETIC INVOICE - NOT PAYABLE",...common,"Total invoice amount: GBP 1500.00"]),
  read(["SYNTHETIC CONTRACT - NOT PAYABLE",...common,"Total contract value: GBP 1250.00","Signed by authorized representatives of both parties"])
 ]);
 const result=await reviewDocumentPair(invoice,contract,"Example Merchant Ltd",await loadInvoiceAiConfig(db));
 return {synthetic:true,production_records_written:0,provider_accounts_called:0,
  all_expected:result.status==="needs_attention"&&result.findings.some(f=>f.code==="amount_mismatch"),
  invoice_ocr:"succeeded",contract_ocr:"succeeded",result};
}
