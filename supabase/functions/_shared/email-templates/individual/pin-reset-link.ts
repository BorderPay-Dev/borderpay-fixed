import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualPinResetLinkProps {
  full_name?: string;
  reset_url: string;
  expires_in_minutes?: number;
}

export function render(p: IndividualPinResetLinkProps): RenderedEmail {
  const fn = firstName(p.full_name);
  const ttl = p.expires_in_minutes ?? 30;
  const subject = "Reset your BorderPay PIN";
  const heading = "Reset your transaction PIN";
  const introText = `Hi ${fn}, use the secure link below to set a new PIN for your BorderPay account.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      This link expires in <strong style="color:${BORDERPAY_BRAND.text};">${ttl} minute${ttl === 1 ? "" : "s"}</strong> and can only be used once.
    </p>
    <p style="margin:18px 0 0;font-size:12px;color:${BORDERPAY_BRAND.textFaint};text-align:center;line-height:1.5;">
      If you did not request a PIN reset, you can ignore this email.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Reset PIN", ctaUrl: p.reset_url }),
    text: textLayout({ heading, body: `Hi ${fn},\nReset your BorderPay PIN (expires in ${ttl}m):`, ctaText: "Reset PIN", ctaUrl: p.reset_url }),
  };
}

