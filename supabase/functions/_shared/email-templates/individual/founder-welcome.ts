import { htmlLayout, textLayout, firstName, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface IndividualFounderWelcomeProps {
  full_name?: string;
}

export function render(p: IndividualFounderWelcomeProps): RenderedEmail {
  const fn = firstName(p.full_name);
  const subject = "Welcome to BorderPay";
  const heading = "Welcome to BorderPay";
  const introText = `Hi ${fn}, welcome aboard. Your account is ready to start verification and global money movement.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      BorderPay helps you receive globally and move money faster with full transparency.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">
      Start by completing verification in your dashboard to unlock all features.
    </p>`;
  return {
    subject,
    html: htmlLayout({ preview: subject, heading, introText, body, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
    text: textLayout({ heading, body: `Hi ${fn}, welcome to BorderPay.`, ctaText: "Open dashboard", ctaUrl: `${BORDERPAY_BRAND.appUrl}/dashboard` }),
  };
}

