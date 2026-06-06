import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Sent when an admin authorizes a (paid) individual's verification — the
 * "finish your document uploads" prompt. Fired by the authorize-verification
 * edge function AFTER the manual-review authorization event (#4). Inert until
 * that function is deployed; routed only via the logged send-email path.
 */
export interface IndividualVerificationAuthorizedProps {
  full_name?: string;
}

export function render(p: IndividualVerificationAuthorizedProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const subject = "You're approved to finish verification";
  const heading = "Verification unlocked";
  const introText = `Hi ${name}, your account has been reviewed and approved to start identity verification.`;
  const closing = "Open BorderPay and complete your document uploads to finish verifying your identity.";

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
