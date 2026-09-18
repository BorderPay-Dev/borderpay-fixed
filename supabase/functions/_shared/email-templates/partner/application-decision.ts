import { BORDERPAY_BRAND, escapeHtml, htmlLayout, textLayout, RenderedEmail } from '../layout.ts';
export const PARTNER_DECISION_COPY = {
  under_review: { subject: 'We are reviewing your BorderPay partner application', heading: 'Partner review started', intro: 'Your partner application is now under review.', next: 'We will notify you when a decision is recorded or if we need more information. You can view your application in the partner portal.' },
  approved: { subject: 'Your BorderPay partner application is approved', heading: 'Partner application approved', intro: 'Your partner application has been approved.', next: 'Open the partner portal to review your next onboarding steps. Production access is enabled separately once setup and the remaining launch requirements are complete.' },
  rejected: { subject: 'Update on your BorderPay partner application', heading: 'Partner application not approved', intro: 'After reviewing your partner application, we are unable to approve it at this time.', next: 'Please review the decision notes below. If any information is incorrect or you need clarification, reply to this email or contact our support team.' },
  suspended: { subject: 'Your BorderPay partner application is suspended', heading: 'Partner application suspended', intro: 'Your partner application status has been changed to suspended.', next: 'Please review the decision notes below and contact our support team about the steps required to resolve this.' },
  more_information: { subject: 'More information needed for your BorderPay partner application', heading: 'More information needed', intro: 'We need some additional information to continue reviewing your partner application.', next: 'Review the requested information below, update your application in the partner portal, and submit it again when complete.' },
} as const;
export type PartnerEmailDecision = keyof typeof PARTNER_DECISION_COPY;
export type PartnerDecisionProps = { company_name: string; decision: PartnerEmailDecision; notes: string; review_id: string };
export function render(p: PartnerDecisionProps): RenderedEmail {
  if (!Object.hasOwn(PARTNER_DECISION_COPY, p.decision)) throw new Error('Unsupported partner decision');
  if (!p.company_name?.trim() || !p.notes?.trim() || !p.review_id?.trim()) throw new Error('Saved company, decision notes and review reference required');
  const copy = PARTNER_DECISION_COPY[p.decision];
  const company = p.company_name.trim();
  const notes = p.notes.trim();
  const ctaUrl = 'https://portal.borderpayafrica.com';
  const body = `<p>${escapeHtml(copy.next)}</p><div style="background:${BORDERPAY_BRAND.bg};border-left:3px solid ${BORDERPAY_BRAND.accent};padding:16px;margin:20px 0;"><strong>Decision notes</strong><p style="margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(notes)}</p></div><p style="font-size:12px;color:${BORDERPAY_BRAND.textFaint};overflow-wrap:anywhere;">Review reference: ${escapeHtml(p.review_id)}</p>`;
  const footerNote = `Need help? Reply to this email or contact ${BORDERPAY_BRAND.supportEmail}.`;
  return { subject: copy.subject,
    html: htmlLayout({ preview: copy.subject, heading: copy.heading, introText: `${company}: ${copy.intro}`, body, ctaText: 'Open partner portal', ctaUrl, footerNote }),
    text: textLayout({ heading: copy.heading, body: `${company}: ${copy.intro}\n\n${copy.next}\n\nDecision notes\n${notes}\n\nReview reference: ${p.review_id}`, ctaText: 'Open partner portal', ctaUrl, footerNote }),
  };
}
