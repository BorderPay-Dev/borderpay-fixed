import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

export interface IndividualVerificationReminderProps {
  full_name?: string;
  verification_url?: string;
  action_message?: string;
}

export function render(p: IndividualVerificationReminderProps): RenderedEmail {
  const name = firstName(p.full_name);
  const subject = "Verify your account";
  const heading = "Complete your verification";
  const introText = `Hello ${name}, your BorderPay account is almost ready.`;
  const closing =
    String(p.action_message || "").trim() ||
    "Complete identity verification in your dashboard to unlock sending, receiving, and global account features.";
  const ctaUrl = (p.verification_url && String(p.verification_url).trim()) || `${BORDERPAY_BRAND.appUrl}/dashboard`;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style=\"margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;\">${closing}</p>`,
      ctaText: "Verify your account",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Verify your account",
      ctaUrl,
    }),
  };
}

