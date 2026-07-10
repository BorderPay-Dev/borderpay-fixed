import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

/** Legacy business verification email template. Never mention activation or paid plans. */
export interface BusinessPaymentReceivedProps {
  company_name?: string;
  kyc_url:       string;
}

export function render(p: BusinessPaymentReceivedProps): RenderedEmail {
  const name = p.company_name || "there";
  const url = p.kyc_url || BORDERPAY_BRAND.appUrl;
  const subject = "Verify your business";
  const heading = "Verify your business";
  const introText = `Hi ${name}, your business verification link is ready.`;
  const closing = "Tap the button below to continue your secure business verification.";

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${closing}</p>`,
      ctaText: "Verify your business",
      ctaUrl: url,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Verify your business",
      ctaUrl: url,
    }),
  };
}
