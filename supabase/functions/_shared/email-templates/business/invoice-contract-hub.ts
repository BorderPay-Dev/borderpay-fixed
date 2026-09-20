import {htmlLayout,textLayout,BORDERPAY_BRAND,type RenderedEmail} from "../layout.ts";

export const INVOICE_HUB_NOTE_TEXT = "Your optional Invoice & Contract Hub is available on the BorderPay web dashboard. Create itemized USD, EUR or GBP invoices with your selected active receiving account, generate a B2B agreement or upload your own contract, and keep supporting documents ready for bank requests. GBP payments must be corporate-to-corporate. Using the hub does not add an invoice-approval requirement to your existing account access; banks may still request information.";
export function invoiceHubNoteHtml():string{
 return '<p style="margin:18px 0 0;color:'+BORDERPAY_BRAND.textMuted+';font-size:14px;line-height:1.65;">'+INVOICE_HUB_NOTE_TEXT+'</p>';
}
export function render():RenderedEmail{
 const subject="Invoices and contracts, ready when your business needs them";
 const heading="Prepare your next business payment";
 const introText="Create invoices and contracts inside BorderPay, and keep the documents behind your payments organized.";
 const body='<ul style="color:'+BORDERPAY_BRAND.textMuted+';font-size:14px;line-height:1.7;padding-left:20px;">'
 +'<li>Create a branded, itemized invoice in USD, EUR or GBP.</li>'
 +'<li>Include your selected active receiving account details.</li>'
 +'<li>Generate a B2B agreement or attach your own signed contract.</li>'
 +'<li>Keep order records, purchase orders and delivery evidence together.</li></ul>'
 +invoiceHubNoteHtml()
 +'<p style="font-size:14px;line-height:1.65;">Open your business dashboard and choose Create Invoice &amp; Contract. The hub is optional for both new and existing businesses.</p>';
 return {subject,html:htmlLayout({preview:subject,heading,introText,body,ctaText:"Open BorderPay",ctaUrl:BORDERPAY_BRAND.appUrl}),
 text:textLayout({heading,body:introText+"\n\n"+INVOICE_HUB_NOTE_TEXT+"\n\nOpen your business dashboard and choose Create Invoice & Contract. The hub is optional for both new and existing businesses.",ctaText:"Open BorderPay",ctaUrl:BORDERPAY_BRAND.appUrl})};
}
