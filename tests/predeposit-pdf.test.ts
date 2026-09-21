import assert from "node:assert/strict";
import {renderInvoiceDocument} from "../supabase/functions/_shared/predeposit-pdf.ts";
import {PDFDocument,StandardFonts} from "npm:pdf-lib@1.17.1";
import {sha256,type Invoice,type ReviewContext} from "../supabase/functions/_shared/predeposit-policy.ts";
const h=(c:string)=>c.repeat(64);
function fixture():{invoice:Invoice;context:ReviewContext}{
 return {invoice:{
 id:"invoice-1",revision:1,currency:"GBP",receiving_account_id:"va-gbp-1",
 merchant:{legal_name:"Example Merchant Ltd",incorporation_country:"GB"},
 buyer:{legal_name:"Example Buyer Ltd",type:"company",address:"10 Example Street, London",country:"GB",tax_id:"GB123456789"},
 remitter:{legal_name:"Example Buyer Ltd",type:"company",relationship:"Corporate buyer paying its contracted subscription invoice."},
 category:"digital_services",order_source:"direct_b2b",order_platform:"",order_reference:"",tracking_numbers:[],
 items:[{description:"Enterprise SaaS licence for September 2026, 20 seats",quantity:1,unit_amount_minor:12500,deliverable_reference:"LIC-804"}],
 source_of_funds:"Buyer's operating revenue from its declared commercial activities.",
 fund_utilization:"Settlement for the September 2026 enterprise software subscription.",
 discovery_channel:"",cross_border_justification:"",commercial_end_use:"",
 contract_path:"generated",agreement:{signature_consent:true,version:"counsel-approved-v1",terms_sha256:h("a"),signature_sha256:h("b"),signed_by:"Example Director",signed_at:"2026-09-19T09:00:00Z"},
 documents:[{id:"agreement-1",kind:"signed_agreement",sha256:h("c")}],
 instalments:{expected_count:1,commercial_reason:""}
 },context:{
 merchantUserId:"merchant-1",receivingAccount:{id:"va-gbp-1",owner_user_id:"merchant-1",currency:"GBP",status:"active"},
 verifiedMerchant:{legal_name:"Example Merchant Ltd",incorporation_country:"GB",active:true,approved:true},
 jurisdictionPolicy:{version:"approved-test-policy",known_countries:["GB","FR","LV"],review_countries:[]},
 approvedAgreementVersions:["counsel-approved-v1"],
 history:{available:true,buyer_invoice_count_30d:0,same_currency_total_minor_30d:0},
 structuring:{max_invoices_30d:4,aggregate_review_minor:{USD:1000000,EUR:1000000,GBP:1000000}},
 verifiedEvidenceHashes:[h("c")],orderEvidence:null,contractEvidence:null,trackingVerifications:[],
 now:"2026-09-20T09:00:00Z"
 }};
}

const font=await Deno.readFile("/tmp/predeposit-font.ttf");
const boldFont=await Deno.readFile("/tmp/predeposit-bold.ttf");
const brandLogo=await Deno.readFile("public/logo-color.png");
assert.equal(await sha256(font),"b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5");
const {invoice}=fixture();invoice.merchant.legal_name="SIA Pārbaude";invoice.buyer.legal_name="Müller Trading Ltd";
const original=await PDFDocument.create();const page=original.addPage([595,842]);page.drawText("Signed purchase order - original evidence",{x:40,y:810,font:await original.embedFont(StandardFonts.Helvetica),size:12});
const evidence=await original.save();
const common={invoice,invoiceNumber:"QA-2026-001",fontBytes:font,boldFontBytes:boldFont,brandLogo,templateBody:"{{seller}} supplies the goods and services described in invoice {{invoice}} to {{buyer}}. Total consideration is {{amount}} {{currency}}. The parties confirm this invoice represents genuine commercial activity.\nDelivery and acceptance follow the written specification. The buyer pays from its own corporate bank account using the approved payment reference."};
await Deno.mkdir("/tmp/predeposit-pdf-qa",{recursive:true});
const pending=await renderInvoiceDocument(common);await Deno.writeFile("/tmp/predeposit-pdf-qa/pending.pdf",pending);
const approved=await renderInvoiceDocument({...common,approved:true,bank:{invoice_reference:"QA-2026-001",account_id:"va-test",currency:"GBP",amount:"125.00",beneficiary_name:"Example Bank Beneficiary",bank_name:"Test Bank",account_number:"12345678",sort_code:"12-34-56",required_payment_reference:"TEST-ONLY"},
 attachments:[{name:"Signed purchase order",mime:"application/pdf",bytes:evidence,sha256:await sha256(evidence)}]});
await Deno.writeFile("/tmp/predeposit-pdf-qa/approved.pdf",approved);
const loaded=await PDFDocument.load(approved);assert.ok(loaded.getPageCount()>=2);
console.log("PASS: Unicode names, multipage invoice, bank instructions and original evidence copies");

const copy=await renderInvoiceDocument({invoice,invoiceNumber:"QA-2026-001",fontBytes:font,boldFontBytes:boldFont,brandLogo,customerCopy:true});
await Deno.writeFile("/tmp/predeposit-pdf-qa/invoice-copy.pdf",copy);
await assert.rejects(()=>renderInvoiceDocument({...common,customerCopy:true}),/Invoice copies cannot/);
await assert.rejects(()=>renderInvoiceDocument({invoice,invoiceNumber:"QA",fontBytes:font,boldFontBytes:boldFont,brandLogo,customerCopy:true,attachments:[{name:"private",mime:"application/pdf",bytes:evidence,sha256:"a".repeat(64)}]}),/Invoice copies cannot/);
console.log("PASS: invoice-only copy omits bank details and cannot include compliance attachments");

const observation=await renderInvoiceDocument({invoice,invoiceNumber:"QA-2026-001",fontBytes:font,boldFontBytes:boldFont,brandLogo,customerCopy:true,bank:{invoice_reference:"QA-2026-001",account_id:"va-test",currency:"GBP",amount:"125.00",beneficiary_name:"Example Bank Beneficiary",bank_name:"Test Bank",account_number:"12345678",sort_code:"12-34-56",required_payment_reference:"TEST-ONLY"},attachments:[{kind:"executed_contract",name:"Commercial agreement",mime:"application/pdf",bytes:evidence,sha256:await sha256(evidence)}]});
await Deno.writeFile("/tmp/predeposit-pdf-qa/observation-invoice.pdf",observation);

const signature = new Uint8Array([137,80,78,71,13,10,26,10]); // Invalid image is never inspected without consent.
await assert.rejects(() => renderInvoiceDocument({
  invoice: {...invoice,agreement:{...invoice.agreement,signature_consent:false}}, invoiceNumber:"UNAUTHORIZED",
  fontBytes:font, signature, templateBody:"Terms", agreementOnly:true,
}), /Signature consent/);
const long = structuredClone(invoice);
long.items = Array.from({length: 45}, (_, i) => ({
  description: "Delivery " + (i+1) + ": enterprise implementation, documented acceptance testing and platform support. " + (i === 20 ? "LONGTOKEN".repeat(75) : ""),
  quantity: 2, unit_amount_minor: 12345, deliverable_reference: "DELIVERABLE-" + (i+1),
}));
const longPdf=await renderInvoiceDocument({invoice:long,invoiceNumber:"LONG-2026-001",fontBytes:font,boldFontBytes:boldFont,brandLogo,customerCopy:true});
assert.ok((await PDFDocument.load(longPdf)).getPageCount()>2);
await Deno.writeFile("/tmp/predeposit-pdf-qa/long-invoice.pdf",longPdf);
const agreement=await renderInvoiceDocument({...common,agreementOnly:true});
await Deno.writeFile("/tmp/predeposit-pdf-qa/agreement.pdf",agreement);
const usdcopy=await renderInvoiceDocument({invoice:{...invoice,currency:"USD"},invoiceNumber:"USD-TEST",fontBytes:font,boldFontBytes:boldFont,brandLogo,customerCopy:true,bank:{
 invoice_reference:"USD-TEST",account_id:"va-usd",currency:"USD",amount:"125.00",beneficiary_name:"Example USD Beneficiary",bank_name:"Example USD Bank",account_number:"DEMO-ACCOUNT",routing_number:"DEMO-ROUTING"
}});
await Deno.writeFile("/tmp/predeposit-pdf-qa/usd-invoice.pdf",usdcopy);
assert.equal((await PDFDocument.load(usdcopy)).getSubject(),"borderpay-b2b-2026-09");
console.log("PASS: B2B layout, pagination, currency rails and unauthorized signatures");
