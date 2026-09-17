import { htmlLayout, textLayout, escapeHtml, type RenderedEmail } from './layout.ts';
export function renderAffiliateReward(p: {company_name?:string;first_name?:string;full_name?:string}):RenderedEmail {
 const heading='Get reduced incoming fees for 30 days';
 const name=p.company_name||p.first_name||p.full_name||'there';
 const body=`Hello ${name},\n\nRefer a business to BorderPay using your personal referral link. When the business completes verification, you earn 30 days of reduced USD, EUR and GBP incoming fees.\n\nOpen your referral portal with your existing verified BorderPay account to copy your link and track signups, verification, earned rewards and remaining days.\n\nRewards start after fee activation. Additional approved business referrals earn consecutive 30-day periods. Provider charges are separate. Rewards reduce fees and cannot be withdrawn as cash.`;
 const ctaUrl='https://affiliate.borderpayafrica.com';
 return {subject:'BorderPay — '+heading,html:htmlLayout({heading,body:body.split('\n\n').map(x=>`<p>${escapeHtml(x)}</p>`).join(''),ctaText:'Open referral portal',ctaUrl}),text:textLayout({heading,body,ctaText:'Open referral portal',ctaUrl})};
}
