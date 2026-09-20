import {htmlLayout,textLayout,BORDERPAY_BRAND,type RenderedEmail} from "../layout.ts";

export const INVOICE_HUB_NOTE_TEXT = "Your optional Invoice & Contract Hub is available on the BorderPay web dashboard. Create itemized USD, EUR or GBP invoices with your selected active receiving account, generate a B2B agreement or upload your own contract, and keep supporting documents ready for bank requests. GBP payments must be corporate-to-corporate. Using the hub does not add an invoice-approval requirement to your existing account access; banks may still request information.";
export function invoiceHubNoteHtml():string{
 return '<p style="margin:18px 0 0;color:'+BORDERPAY_BRAND.textMuted+';font-size:14px;line-height:1.65;">'+INVOICE_HUB_NOTE_TEXT+'</p>';
}
export function render():RenderedEmail{
 const subject="Create your invoices and business agreements inside BorderPay";
 const heading="Less paperwork. Better-prepared payments.";
 const introText="Your business can now prepare invoices, agreements and supporting documents in one place.";
 const why="Missing invoices, unclear payment purposes or incomplete contracts can lead to bank reviews, account restrictions, rejected payments or refunds. We built the Invoice & Contract Hub to help you document each payment clearly, reduce avoidable delays and respond more quickly when a bank asks for information.";
 const convenience="Save time preparing your payment paperwork. Create your invoice and standard B2B agreement inside BorderPay, without buying a separate invoicing or contract-generation tool for these documents.";
 const features=[
  "Create a branded, itemized invoice in USD, EUR or GBP.",
  "Select an active receiving account to include its bank payment details on the invoice.",
  "Generate a standard B2B agreement using your invoice details and merchant signature, or upload an existing signed contract.",
  "Download the invoice and agreement PDF to share with your buyer.",
  "Keep purchase orders, store or CRM records, and delivery or warehouse evidence together for payment reviews."
 ];
 const steps="To get started, sign in to the BorderPay web dashboard, open Quick Actions and select Create Invoice & Contract. Complete your buyer and item details, choose your receiving account, then prepare your agreement and download your documents.";
 const reminder="Ask your buyer to pay from the business named on the invoice and use the payment reference provided. GBP payments are strictly corporate-to-corporate.";
 const note="The hub is optional for new and existing businesses. It does not add an invoice-approval requirement to your account. Documents support a bank review; they cannot guarantee that a payment will avoid a hold, rejection or refund. A standard agreement may need adapting to your business and transaction.";
 const paragraph=(text:string)=>'<p style="margin:0 0 16px;">'+text+'</p>';
 const body=paragraph("Hello,")+paragraph(why)+paragraph(convenience)
  +'<ul style="margin:0 0 20px;padding-left:20px;">'+features.map(x=>'<li style="margin-bottom:8px;">'+x+'</li>').join('')+'</ul>'
  +paragraph(steps)+paragraph(reminder)
  +'<p style="font-size:12px;line-height:1.6;color:'+BORDERPAY_BRAND.textFaint+';">'+note+'</p>';
 return {subject,html:htmlLayout({preview:"Prepare payment paperwork in BorderPay and help reduce avoidable delays.",heading,introText,body,ctaText:"Open Invoice & Contract Hub",ctaUrl:BORDERPAY_BRAND.appUrl}),
 text:textLayout({heading,body:[introText,why,convenience,...features,steps,reminder,note].join("\n\n"),ctaText:"Open BorderPay",ctaUrl:BORDERPAY_BRAND.appUrl})};
}
