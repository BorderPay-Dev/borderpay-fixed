import { PDFDocument, rgb, type PDFPage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import type { Invoice } from "./predeposit-policy.ts";
import type { BankPaymentInstructions } from "./predeposit-payment-instructions.ts";
export type PdfAttachment={kind?:"signed_agreement"|"executed_contract";name:string;mime:string;bytes:Uint8Array;sha256:string};
export async function renderInvoiceDocument(args:{
 invoice:Invoice;invoiceNumber:string;fontBytes:Uint8Array;templateBody?:string;
 logo?:Uint8Array;signature?:Uint8Array;bank?:BankPaymentInstructions;
 customerCopy?:boolean;attachments?:PdfAttachment[];agreementOnly?:boolean;approved?:boolean;complianceReview?:{assessment:unknown;recorded_at:string};
}):Promise<Uint8Array>{
 if(args.customerCopy&&(args.attachments?.some(a=>!["signed_agreement","executed_contract"].includes(a.kind||""))||args.templateBody||args.signature||args.complianceReview))throw Error("Invoice copies cannot contain private compliance documents or unverified agreements");
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(args.fontBytes,{subset:true});
 const money=(n:number)=>{const v=BigInt(n);return String(v/100n)+"."+String(v%100n).padStart(2,"0");};
 const inv=args.invoice;let page!:PDFPage;let y=0;const width=595,height=842,margin=46;
 const ink=rgb(.08,.1,.11),muted=rgb(.37,.41,.43),green=rgb(.68,.85,0);
 const newPage=()=>{page=doc.addPage([width,height]);y=height-52;};
 newPage();
 const wrap=(value:string,size:number,max=width-margin*2)=>{
  const words=String(value??"").replace(/\r/g,"").split(/\s+/u);const lines:string[]=[];let line="";
  for(const word of words){
   if(font.widthOfTextAtSize(word,size)>max){
    if(line){lines.push(line);line="";}let part="";
    for(const c of word){if(font.widthOfTextAtSize(part+c,size)>max){lines.push(part);part=c;}else part+=c;}if(part)line=part;
   }else if(font.widthOfTextAtSize((line?line+" ":"")+word,size)>max){lines.push(line);line=word;}else line+=(line?" ":"")+word;
  }if(line)lines.push(line);return lines;
 };
 const text=(value:string,size=10,color=ink)=>{
  for(const paragraph of String(value??"").split("\n")){
   for(const line of wrap(paragraph,size)){if(y<68)newPage();page.drawText(line,{x:margin,y,size,font,color});y-=size+5;}
   if(!paragraph)y-=5;
  }
 };
 const title=(value:string)=>{if(y<115)newPage();y-=12;text(value,15);y-=7;};
 const line=()=>{page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:1,color:green});y-=16;};
 const image=async(bytes:Uint8Array,maxWidth:number,maxHeight:number)=>{
  const img=bytes[0]===137?await doc.embedPng(bytes):await doc.embedJpg(bytes);const scale=Math.min(maxWidth/img.width,maxHeight/img.height);
  if(y-maxHeight<65)newPage();page.drawImage(img,{x:margin,y:y-img.height*scale,width:img.width*scale,height:img.height*scale});y-=img.height*scale+12;
 };
 if(args.logo)await image(args.logo,145,54);
 text(inv.merchant.legal_name,20);text(args.agreementOnly?"B2B Commercial Agreement":"Commercial Invoice",12,muted);line();
 text("Invoice: "+args.invoiceNumber+"  |  Revision: "+inv.revision,10);
 if(args.customerCopy&&!args.bank)text("INVOICE COPY - PAYMENT DETAILS NOT INCLUDED",10,muted);
 else if(!args.customerCopy&&!args.approved&&!args.agreementOnly)text("UNDER REVIEW - NOT PAYMENT INSTRUCTIONS",10,muted);
 title("Parties");
 text("Seller: "+inv.merchant.legal_name+" ("+inv.merchant.incorporation_country+")");
 text("Buyer: "+inv.buyer.legal_name);text(inv.buyer.address+" | "+inv.buyer.country);text("Tax / VAT ID: "+inv.buyer.tax_id);
 title("Goods and services");
 let total=0;
 for(const [index,item] of inv.items.entries()){
  const amount=item.quantity*item.unit_amount_minor;total+=amount;
  text((index+1)+". "+item.description,11);text("Reference: "+item.deliverable_reference,9,muted);
  text("Quantity "+item.quantity+"  |  Unit "+money(item.unit_amount_minor)+" "+inv.currency+"  |  Total "+money(amount)+" "+inv.currency);
  y-=7;
 }
 line();text("Total: "+money(total)+" "+inv.currency,16);
 if(args.templateBody){
  title("Commercial agreement");
  const terms=args.templateBody.replaceAll("{{seller}}",inv.merchant.legal_name).replaceAll("{{buyer}}",inv.buyer.legal_name)
   .replaceAll("{{amount}}",money(total)).replaceAll("{{currency}}",inv.currency).replaceAll("{{invoice}}",args.invoiceNumber);
  text(terms);text("Agreement version: "+inv.agreement.version,9,muted);
  if(args.signature){title("Merchant execution");await image(args.signature,220,70);text(inv.agreement.signed_by);text("Accepted: "+inv.agreement.signed_at,9,muted);}
 }
 if(!args.customerCopy && !args.agreementOnly && !args.bank){
  title("1. Sender and commercial relationship");
  text("Expected remitter: "+inv.remitter.legal_name);text("Relationship: "+inv.remitter.relationship);
  title("2. Payment purpose and fund utilization");text("Use of funds: "+inv.fund_utilization);
  if(inv.discovery_channel)text("Buyer acquisition: "+inv.discovery_channel);
  if(inv.cross_border_justification)text("Cross-border rationale: "+inv.cross_border_justification);
  if(inv.commercial_end_use)text("Commercial end use: "+inv.commercial_end_use);
  text("Order source: "+inv.order_source+(inv.order_platform?" / "+inv.order_platform:""));
  if(inv.order_reference)text("Order reference: "+inv.order_reference);
  title("3. Source of funds and supporting evidence");text("Source of funds: "+inv.source_of_funds);
  if(args.complianceReview){text("Review recorded: "+args.complianceReview.recorded_at,9,muted);text("Evidence assessment: "+JSON.stringify(args.complianceReview.assessment),8,muted);}
 }
 if(args.bank){
  title("Bank payment instructions");const b=args.bank;
  text("Pay "+b.amount+" "+b.currency,14);text("Beneficiary: "+b.beneficiary_name);text("Bank: "+b.bank_name);
  for(const [label,value] of [["Account number",b.account_number],["Routing number",b.routing_number],["Sort code",b.sort_code],["IBAN",b.iban],["BIC",b.bic]])if(value)text(label+": "+value);
  if(b.required_payment_reference)text("Required bank reference: "+b.required_payment_reference);
  text("Invoice reference: "+args.invoiceNumber);
  if(inv.currency==="GBP")text("GBP payments must come from the corporate buyer named on this invoice.",10,muted);
 }
 const attachments=args.attachments||[];
 if(attachments.length && !args.agreementOnly){
  title(args.customerCopy?"Attached agreement":"Evidence manifest");text(args.customerCopy?"A copy of the commercial agreement follows.":"Original files are retained separately. Copies below are for review.",9,muted);
  for(const a of attachments){text(a.name,10);if(!args.customerCopy)text("SHA-256: "+a.sha256,8,muted);}
  for(const a of attachments){
   if(a.mime==="application/pdf"){
    const original=await PDFDocument.load(a.bytes,{ignoreEncryption:false});
    if(original.getPageCount()>100)throw Error("Attachment has too many pages");
    const embedded=await doc.embedPages(original.getPages());
    for(const p of embedded){newPage();text(a.name,9,muted);const scale=Math.min((width-2*margin)/p.width,(height-130)/p.height);page.drawPage(p,{x:margin,y:65,width:p.width*scale,height:p.height*scale});}
   }else{
    newPage();text(a.name,12);await image(a.bytes,width-margin*2,650);
   }
  }
 }
 // Add unobtrusive pagination to generated pages only; preserve original evidence text.
 const pages=doc.getPages();
 for(let i=0;i<pages.length;i++){const p=pages[i];const label="BorderPay | "+args.invoiceNumber+" | "+(i+1)+" / "+pages.length;
  p.drawText(label,{x:margin,y:24,size:8,font,color:muted});}
 doc.setTitle(args.invoiceNumber+" - "+inv.merchant.legal_name);doc.setAuthor(inv.merchant.legal_name);doc.setCreator("BorderPay Invoice & Agreement Hub");
 return doc.save();
}
