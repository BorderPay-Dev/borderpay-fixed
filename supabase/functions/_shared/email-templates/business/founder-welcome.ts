import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail, escapeHtml } from "../layout.ts";

export interface BusinessFounderWelcomeProps {
  full_name?: string;
  company_name?: string;
}

export function render(p: BusinessFounderWelcomeProps): RenderedEmail {
  const company = p.company_name || "your business";
  const subject = "Welcome to BorderPay Business";
  const heading = "Welcome to BorderPay Business";
  const introText = `Welcome ${escapeHtml(company)}. Your business account is ready to complete verification and activate global operations.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Use BorderPay to receive internationally and manage treasury flows in one place.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Complete KYB in your dashboard to unlock all business capabilities.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
    text: textLayout({ heading, body: `Welcome ${company}.`, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
  };
}

