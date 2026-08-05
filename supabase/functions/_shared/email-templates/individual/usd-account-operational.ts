import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, RenderedEmail } from "../layout.ts";

export interface IndividualUsdAccountOperationalProps {
  full_name?: string;
  action_url?: string;
}

export function render(p: IndividualUsdAccountOperationalProps): RenderedEmail {
  const name = firstName(p.full_name);
  const subject = "USD receiving accounts are operational";
  const heading = "Your USD account is available";
  const introText = `Hello ${name}, USD receiving-account activation is operational again.`;
  const bodyText =
    "You previously requested a USD receiving account while activation was unavailable. Sign in to BorderPay and activate USD from Manage accounts & wallets. If your USD account is already active, its banking details will appear there automatically.";
  const ctaUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body: `<p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;text-align:center;">${bodyText}</p>`,
      ctaText: "Open BorderPay",
      ctaUrl,
      brandTone: "default",
    }),
    text: textLayout({
      heading,
      body: `${introText}\n\n${bodyText}`,
      ctaText: "Open BorderPay",
      ctaUrl,
    }),
  };
}
