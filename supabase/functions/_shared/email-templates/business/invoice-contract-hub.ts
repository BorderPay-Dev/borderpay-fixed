import {INVOICE_HUB_CAMPAIGN} from "./invoice-contract-hub-copy.ts";
import {htmlLayout,textLayout,BORDERPAY_BRAND,type RenderedEmail} from "../layout.ts";

export const INVOICE_HUB_NOTE_TEXT = "Your optional Invoice & Contract Hub is available on the BorderPay web dashboard. Create itemized USD, EUR or GBP invoices with your selected active receiving account, generate a B2B agreement or upload your own contract, and keep supporting documents ready for bank requests. GBP payments must be corporate-to-corporate. Using the hub does not add an invoice-approval requirement to your existing account access; banks may still request information.";
export function invoiceHubNoteHtml():string{
 return '<p style="margin:18px 0 0;color:'+BORDERPAY_BRAND.textMuted+';font-size:14px;line-height:1.65;">'+INVOICE_HUB_NOTE_TEXT+'</p>';
}
export function render():RenderedEmail{
 const {subject,heading,intro:introText,understanding,why,convenience,features,steps,reminder,note}=INVOICE_HUB_CAMPAIGN;
 const paragraph=(text:string)=>'<p style="margin:0 0 16px;">'+text+'</p>';
 const body=paragraph("Hello,")+paragraph(understanding)+paragraph(why)+paragraph(convenience)
  +'<ul style="margin:0 0 20px;padding-left:20px;">'+features.map(x=>'<li style="margin-bottom:8px;">'+x+'</li>').join('')+'</ul>'
  +paragraph(steps)+paragraph(reminder)
  +'<p style="font-size:12px;line-height:1.6;color:'+BORDERPAY_BRAND.textFaint+';">'+note+'</p>';
 return {subject,html:htmlLayout({preview:"Prepare payment paperwork in BorderPay and help reduce avoidable delays.",heading,introText,body,ctaText:"Open Invoice & Contract Hub",ctaUrl:BORDERPAY_BRAND.appUrl}),
 text:textLayout({heading,body:[introText,understanding,why,convenience,...features,steps,reminder,note].join("\n\n"),ctaText:"Open BorderPay",ctaUrl:BORDERPAY_BRAND.appUrl})};
}
