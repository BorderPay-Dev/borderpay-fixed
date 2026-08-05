import { htmlLayout, textLayout, BORDERPAY_BRAND, escapeHtml, RenderedEmail } from "../layout.ts";

export interface BusinessUsdAccountOperationalProps {
  company_name?: string;
  action_url?: string;
}

export function render(p: BusinessUsdAccountOperationalProps): RenderedEmail {
  const company = String(p.company_name || "Your business");
  const subject = "USD receiving accounts are operational";
  const heading = "Your USD account is available";
  const introText = `${escapeHtml(company)} can now activate its USD receiving account.`;
  const bodyText =
    "Your business previously requested a USD receiving account while activation was unavailable. Sign in to BorderPay and activate USD from Manage accounts & wallets. If the account is already active, its banking details will appear there automatically.";
  const ctaUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${escapeHtml(bodyText)}</p>`,
      ctaText: "Open BorderPay",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${company} can now activate its USD receiving account.\n\n${bodyText}`,
      ctaText: "Open BorderPay",
      ctaUrl,
    }),
  };
}
