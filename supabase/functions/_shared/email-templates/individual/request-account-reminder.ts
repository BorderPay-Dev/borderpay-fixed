import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

export interface IndividualRequestAccountReminderProps {
  full_name?: string;
  action_url?: string;
}

export function render(p: IndividualRequestAccountReminderProps): RenderedEmail {
  const name = firstName(p.full_name);
  const subject = "Request your BorderPay account";
  const heading = "Request your account";
  const introText = `Hello ${name}, your verification is complete.`;
  const bodyText =
    "You can now request your USD, EUR, or GBP virtual account from the BorderPay app. Once requested, we will provision the account and notify you when it is ready.";
  const ctaUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${bodyText}</p>`,
      ctaText: "Request account",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${bodyText}`,
      ctaText: "Request account",
      ctaUrl,
    }),
  };
}
