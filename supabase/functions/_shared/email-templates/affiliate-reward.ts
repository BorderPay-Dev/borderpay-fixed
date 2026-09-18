import { htmlLayout, textLayout, escapeHtml, type RenderedEmail } from './layout.ts';

export function renderAffiliateReward(p: { company_name?: string; first_name?: string; full_name?: string }): RenderedEmail {
  const heading = 'Refer a business. Enjoy lower incoming fees.';
  const name = p.company_name || p.first_name || p.full_name || 'there';
  const paragraphs = [
    `Hello ${name},`,
    'Know a business that could benefit from BorderPay? Share your personal referral link and earn 30 days of reduced incoming fees when that business completes verification.',
    'You already have everything you need. Sign in to the affiliate portal using the same email and password as your existing BorderPay account. No separate account or new registration is needed. Your referrals and rewards stay linked to your BorderPay account.',
    'Getting started is simple:',
    '1. Sign in to your affiliate portal.\n2. Copy your personal referral link and share it with a business.\n3. When the business signs up through your link and completes business verification, you earn your reward.',
    'Follow each referral from signup to verification, check reward activation, and see your remaining reward days in the portal.',
    'Your reward gives you reduced fees on eligible USD, EUR and GBP incoming payments for 30 days after activation. Each additional qualifying business referral earns another consecutive 30-day period.',
    'Ready to share BorderPay? Your referral link is waiting.',
    'The BorderPay Africa Team',
  ];
  const terms = 'Available to active, verified BorderPay members. Rewards begin after fee activation. Provider charges are separate. Rewards are fee reductions, not cash payouts.';
  const ctaUrl = 'https://affiliate.borderpayafrica.com/login';
  return {
    subject: 'Refer a business. Get 30 days of lower incoming fees.',
    html: htmlLayout({
      heading,
      preview: 'Use your existing BorderPay login. Share your link and track your rewards.',
      body: paragraphs.map(text => `<p>${escapeHtml(text).replace(/\n/g, '<br />')}</p>`).join(''),
      ctaText: 'Get my referral link', ctaUrl,
      footerNote: escapeHtml(terms),
    }),
    text: textLayout({ heading, body: [...paragraphs, terms].join('\n\n'), ctaText: 'Get my referral link', ctaUrl }),
  };
}
