import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Business KYB variant of the "finish your document uploads" prompt, sent when
 * an admin authorizes a (paid) business's verification (#4). Inert until the
 * authorize-verification edge function is deployed; routed via send-email only.
 */
export interface BusinessVerificationAuthorizedProps {
  full_name?:    string;
  company_name?: string;
  verification_url?: string;
}

export function render(p: BusinessVerificationAuthorizedProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const company = p.company_name ? ` for ${p.company_name}` : "";
  const subject = "Verify your business";
  const heading = "Verify your business";
  const introText = `Hello ${name}, thank you for choosing BorderPay.`;
  const closing = `To activate all business features${company}, please verify your business from your dashboard.`;
  const ctaUrl = (p.verification_url && String(p.verification_url).trim()) || `${BORDERPAY_BRAND.appUrl}/dashboard`;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${closing}</p>`,
      ctaText: "Verify your business",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Verify your business",
      ctaUrl,
    }),
  };
}
