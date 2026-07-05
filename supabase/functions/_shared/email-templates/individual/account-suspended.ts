import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualAccountSuspendedProps {
  full_name?: string;
}

export function render(p: IndividualAccountSuspendedProps): RenderedEmail {
  const fn = firstName(p.full_name);
  const subject = "Important update about your BorderPay account";
  const heading = "Account temporarily suspended";
  const introText = `Hi ${fn}, your BorderPay account has been temporarily suspended for security/compliance review.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Our team can help you resolve this quickly.
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
    text: textLayout({ heading, body: "Your account is temporarily suspended. Contact support for next steps.", ctaText: "Support", ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}` }),
  };
}

