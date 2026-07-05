import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

interface Props {
  company_name?: string;
  full_name?: string;
  minimum_deposit?: string;
  stablecoins?: string;
  action_url?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const companyName = String(props.company_name || "").trim() || "your business";
  const fullName = String(props.full_name || "").trim();
  const minimumDeposit = String(props.minimum_deposit || "$50").trim();
  const stablecoins = String(props.stablecoins || "USDC/USDT").trim();
  const actionUrl = String(props.action_url || "https://app.borderpayafrica.com").trim();
  const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
  const subject = "Make your first transaction to unlock your business global accounts";
  const heading = "Unlock your business global accounts";
  const introText = `${greeting} ${companyName} is almost ready.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Complete your first transfer or deposit of at least <strong>${escapeHtml(minimumDeposit)}</strong> in <strong>${escapeHtml(stablecoins)}</strong>.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Once completed, your USD, EUR, and GBP business receive accounts unlock automatically.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      This is not an activation fee. Funds remain in your wallet and are available to use. No hidden charges.
    </p>
  `;

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      footerNote: "If your team needs assistance, contact support from your BorderPay dashboard.",
    }),
    text: textLayout({
      heading,
      body:
        `${greeting} ${companyName} is almost ready.\n\n` +
        `Complete your first transfer or deposit of at least ${minimumDeposit} in ${stablecoins}.\n` +
        "Once completed, your USD, EUR, and GBP business receive accounts unlock automatically.\n\n" +
        "This is not an activation fee. Funds remain in your wallet. No hidden charges.",
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      footerNote: "If your team needs assistance, contact support from your BorderPay dashboard.",
    }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
