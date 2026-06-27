import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualEmailVerificationProps {
  full_name?:        string;
  verification_url:  string;
  expires_in_hours?: number;
}

export function render(p: IndividualEmailVerificationProps): RenderedEmail {
  const fn  = firstName(p.full_name);
  const ttl = p.expires_in_hours ?? 24;
  const subject = "Confirm your BorderPay account";
  const heading = "Confirm your email";
  const introText = `Hi ${fn}, thanks for joining BorderPay Africa. Tap the button below to verify this email and activate your account.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      For security, this link expires in <strong style="color:${BORDERPAY_BRAND.text};">${ttl} hour${ttl === 1 ? '' : 's'}</strong> and can only be used once.
    </p>`;
  const footerNote = "If you didn't sign up for BorderPay, you can safely ignore this email.";
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Verify my email", ctaUrl: p.verification_url, footerNote }),
    text: textLayout({ heading, body: `Hi ${fn},\nClick to verify your email (expires in ${ttl}h):`, ctaText: "Verify my email", ctaUrl: p.verification_url, footerNote }),
  };
}
