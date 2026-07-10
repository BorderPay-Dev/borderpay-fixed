import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/** Legacy verification email template. Never mention activation or paid plans. */
export interface IndividualPaymentReceivedProps {
  full_name?: string;
  kyc_url:    string;
}

export function render(p: IndividualPaymentReceivedProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const url = p.kyc_url || BORDERPAY_BRAND.appUrl;
  const subject = "Verify your identity";
  const heading = "Verify your identity";
  const introText = `Hi ${name}, your verification link is ready.`;
  const closing = "Tap the button below to continue your secure identity verification.";

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${closing}</p>`,
      ctaText: "Verify your identity",
      ctaUrl: url,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Verify your identity",
      ctaUrl: url,
    }),
  };
}
