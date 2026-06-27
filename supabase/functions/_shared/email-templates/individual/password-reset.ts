import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualPasswordResetProps {
  full_name?:       string;
  reset_url:        string;
  expires_in_minutes?: number;
}

export function render(p: IndividualPasswordResetProps): RenderedEmail {
  const fn  = firstName(p.full_name);
  const ttl = p.expires_in_minutes ?? 60;
  const subject = "Reset your BorderPay password";
  const heading = "Reset your password";
  const introText = `Hi ${fn}, we got a request to reset your BorderPay password. Tap below to choose a new one.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      This link expires in <strong style="color:${BORDERPAY_BRAND.text};">${ttl} minute${ttl === 1 ? '' : 's'}</strong> and can only be used once.
    </p>
    <p style="margin:18px 0 0;font-size:12px;color:${BORDERPAY_BRAND.textFaint};text-align:center;line-height:1.5;">
      If you didn't request this, your password is still safe — you can ignore this email.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Reset password", ctaUrl: p.reset_url }),
    text: textLayout({ heading, body: `Hi ${fn},\nReset your BorderPay password (expires in ${ttl}m):`, ctaText: "Reset password", ctaUrl: p.reset_url }),
  };
}
