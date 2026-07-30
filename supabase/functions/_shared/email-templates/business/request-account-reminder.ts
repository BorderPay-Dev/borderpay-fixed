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
    "You can now request USD, EUR, or GBP accounts from the BorderPay dashboard. Follow the steps below to request only the accounts your business needs.";
  const steps = [
    "Go to your BorderPay dashboard.",
    "Click Add accounts.",
    "Choose the available USD, EUR, or GBP accounts you want to request.",
    "Submit the request and wait for the account to become active.",
    "After activation, open the Wallet menu to view and share your active account details.",
  ];
  const ctaUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);
  const stepsHtml = `<ol style="margin:16px 0 0;padding-left:22px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
    ${steps.map((step) => `<li style="margin:0 0 8px;">${escapeHtml(step)}</li>`).join("")}
  </ol>`;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(bodyText)}</p>${stepsHtml}`,
      ctaText: "Request account",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${bodyText}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
      ctaText: "Request account",
      ctaUrl,
    }),
  };
}
