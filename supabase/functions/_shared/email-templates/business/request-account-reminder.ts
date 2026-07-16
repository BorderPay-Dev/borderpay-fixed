import { htmlLayout, textLayout, BORDERPAY_BRAND, escapeHtml, RenderedEmail } from "../layout.ts";

export interface BusinessRequestAccountReminderProps {
  company_name?: string;
  action_url?: string;
}

export function render(p: BusinessRequestAccountReminderProps): RenderedEmail {
  const company = String(p.company_name || "your business");
  const subject = `${company}: request your BorderPay account`;
  const heading = "Request your business account";
  const introText = `${company} is verified and ready for account setup.`;
  const bodyText =
    "You can now request USD, EUR, or GBP virtual accounts from the BorderPay dashboard. Once requested, we will provision the account and notify your team when it is ready.";
  const ctaUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(bodyText)}</p>`,
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
