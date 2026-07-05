import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail, escapeHtml } from "../layout.ts";

export interface BusinessAccountSuspendedProps {
  company_name?: string;
}

export function render(p: BusinessAccountSuspendedProps): RenderedEmail {
  const company = p.company_name || "your business";
  const subject = "Important update about your BorderPay business account";
  const heading = "Business account temporarily suspended";
  const introText = `${escapeHtml(company)} has been temporarily suspended for security/compliance review.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Our operations team can help you resolve this quickly.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Please contact support for next steps.
    </p>`;
  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Contact support",
      ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}`,
      brandTone: "warning",
    }),
    text: textLayout({ heading, body: `${company} is temporarily suspended. Contact support for next steps.`, ctaText: "Support", ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}` }),
  };
}

