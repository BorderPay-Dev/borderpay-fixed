import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

/**
 * Generic KYB reminder for business accounts that signed up but have not
 * completed verification yet. This is distinct from UBO/shareholder follow-up
 * reminders (business.verification_authorized).
 */
export interface BusinessVerificationReminderProps {
  full_name?: string;
  company_name?: string;
  verification_url?: string;
  action_message?: string;
}

export function render(p: BusinessVerificationReminderProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const company = p.company_name || "your business";
  const subject = "One step left to verify your BorderPay business account";
  const heading = "Your business is one step away";
  const introText = `Hello ${name}, your ${company} account is almost ready.`;
  const closing =
    String(p.action_message || "").trim() ||
    "Complete business verification in your dashboard so BorderPay can finish setting up your business account for global accounts, receiving, and payouts.";
  const ctaUrl = (p.verification_url && String(p.verification_url).trim()) || `${BORDERPAY_BRAND.appUrl}/dashboard`;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style=\"margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;\">${closing}</p>`,
      ctaText: "Finish business verification",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${closing}`,
      ctaText: "Finish business verification",
      ctaUrl,
    }),
  };
}
