import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

export interface BusinessOwnershipReviewProps {
  full_name?: string;
  company_name?: string;
}

export function render(p: BusinessOwnershipReviewProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const company = p.company_name || "your business";
  const subject = `Ownership review required for ${company}`;
  const heading = "Your application is under review";
  const introText = `Hello ${name}, we need to confirm beneficial-owner information for ${company}.`;
  const message = "BorderPay Operations will contact you with the secure next step. Please do not restart verification or create another account while this review is open.";
  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(message)}</p>`,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
      brandTone: "warning",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${message}`,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
