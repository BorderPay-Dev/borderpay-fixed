import { htmlLayout, textLayout, escapeHtml, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface BusinessAccountActivatedProps {
  company_name:    string;
  contact_full_name?: string;
}

export function render(p: BusinessAccountActivatedProps): RenderedEmail {
  const company = p.company_name || "your business";
  const subject = `${company} is live on BorderPay Africa`;
  const heading = "Your business is live";
  const introText = `Welcome aboard. ${company} is fully activated and ready to move money.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      You can now:
    </p>
    <ul style="margin:0;padding-left:20px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.7;">
      <li>Receive into multi-currency wallets (USD, NGN, KES, GHS, …)</li>
      <li>Send via local bank, mobile money, USD wires, and stablecoins</li>
      <li>Issue corporate VISA / Mastercard cards with spend limits</li>
      <li>Invite teammates with role-based access (coming soon)</li>
    </ul>
    <p style="margin:18px 0 0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      First step: top up a wallet so you can start moving money. Tap below to open your dashboard.
    </p>`;
  return {
    subject,
    html: htmlLayout({
      preview: subject, heading, introText, body,
      ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
    text: textLayout({
      heading,
      body: `${company} is fully activated. Wallets, transfers, cards unlocked.`,
      ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
