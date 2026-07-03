import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessPinResetLinkProps {
  company_name?: string;
  contact_full_name?: string;
  reset_url: string;
  expires_in_minutes?: number;
}

export function render(p: BusinessPinResetLinkProps): RenderedEmail {
  const ttl = p.expires_in_minutes ?? 30;
  const company = String(p.company_name || "your business");
  const name = String(p.contact_full_name || company);
  const subject = "Reset your BorderPay PIN";
  const heading = "Reset your transaction PIN";
  const introText = `Hi ${name}, use the secure link below to set a new PIN for your BorderPay business account.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      This link expires in <strong style="color:${BORDERPAY_BRAND.text};">${ttl} minute${ttl === 1 ? "" : "s"}</strong> and can only be used once.
    </p>
    <p style="margin:18px 0 0;font-size:12px;color:${BORDERPAY_BRAND.textFaint};text-align:center;line-height:1.5;">
      If you did not request a PIN reset for ${company}, you can ignore this email.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Reset PIN", ctaUrl: p.reset_url }),
    text: textLayout({ heading, body: `${company}\nReset your BorderPay PIN (expires in ${ttl}m):`, ctaText: "Reset PIN", ctaUrl: p.reset_url }),
  };
}

