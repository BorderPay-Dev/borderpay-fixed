import { htmlLayout, textLayout, BORDERPAY_BRAND, type RenderedEmail } from './layout.ts';
import { restrictionNotice, type RestrictionKind } from '../account-restriction-copy.ts';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderRestrictionNotice(kind: RestrictionKind, currencies: string[] = []): RenderedEmail {
 const n=restrictionNotice(kind,currencies);
 const body=n.paragraphs.map(p=>'<p style="margin:0 0 14px;color:'+BORDERPAY_BRAND.textMuted+';font-size:14px;line-height:1.65">'+escape(p)+'</p>').join('');
 const url='https://app.borderpayafrica.com/settings/support';
 return {subject:n.subject,
 html:htmlLayout({preview:n.subject,heading:n.heading,body,ctaText:'Contact BorderPay support',ctaUrl:url,brandTone:'warning'}),
 text:textLayout({heading:n.heading,body:n.paragraphs.join('\n\n'),ctaText:'Contact BorderPay support',ctaUrl:url,footerNote:'support@borderpayafrica.com'})};
}
