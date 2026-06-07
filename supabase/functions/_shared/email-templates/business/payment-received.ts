import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

/**
 * Sent right after a successful one-time business activation payment. Embeds the
 * secure hosted business-verification (KYB) link so the user can verify straight
 * from the email — the in-app KYC/KYB screen is read-only status. Fired
 * best-effort by the subscription-upgrade function via the logged send-email
 * path. White-label: never names the underlying verification provider.
 */
export interface BusinessPaymentReceivedProps {
  company_name?: string;
  kyc_url:       string;
}

export function render(p: BusinessPaymentReceivedProps): RenderedEmail {
  const name = p.company_name || "there";
  const url = p.kyc_url || BORDERPAY_BRAND.appUrl;
  const subject = "Payment received — verify your business";
  const heading = "Payment received";
  const introText = `Thanks! The activation payment for ${name} was received.`;
  const closing = "One last step: complete business verification to finish setting up your account. Tap the button below to start your secure verification.";

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
