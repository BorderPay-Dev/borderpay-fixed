import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Sent right after a successful one-time activation payment. Embeds the user's
 * secure hosted identity-verification link so they can verify straight from the
 * email — the in-app KYC screen is read-only status. Fired best-effort by the
 * subscription-upgrade function via the logged send-email path.
 *
 * White-label: never names the underlying verification provider. No
 * money-movement overpromises (the link is for verification only).
 */
export interface IndividualPaymentReceivedProps {
  full_name?: string;
  kyc_url:    string;
}

export function render(p: IndividualPaymentReceivedProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const url = p.kyc_url || BORDERPAY_BRAND.appUrl;
  const subject = "Payment received — verify your identity";
  const heading = "Payment received";
  const introText = `Thanks ${name}! Your activation payment was received.`;
  const closing = "One last step: verify your identity to finish setting up your account. Tap the button below to start your secure verification — it only takes a few minutes.";

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
