import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Business KYB variant of the "finish your document uploads" prompt, sent when
 * an admin authorizes a (paid) business's verification (#4). Inert until the
 * authorize-verification edge function is deployed; routed via send-email only.
 */
export interface BusinessVerificationAuthorizedProps {
  full_name?:    string;
  company_name?: string;
}

export function render(p: BusinessVerificationAuthorizedProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const company = p.company_name ? ` for ${p.company_name}` : "";
  const subject = "Your business is approved to finish verification";
  const heading = "Business verification unlocked";
  const introText = `Hi ${name}, your business${company} has been reviewed and approved to start KYB verification.`;
  const closing = "Open BorderPay and complete your business document uploads to finish verifying.";

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${closing}</p>`,
      ctaText: "Finish verification",
      ctaUrl: BORDERPAY_BRAND.appUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Finish verification",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
