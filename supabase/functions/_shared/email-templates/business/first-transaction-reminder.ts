import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

interface Props {
  company_name?: string;
  full_name?: string;
  stablecoins?: string;
  action_url?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const companyName = String(props.company_name || "").trim() || "your business";
  const fullName = String(props.full_name || "").trim();
  const stablecoins = String(props.stablecoins || "USDC/USDT").trim();
  const actionUrl = String(props.action_url || "https://app.borderpayafrica.com").trim();
  const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
  const subject = "Your business BorderPay account is ready";
  const heading = "Your business global accounts are ready";
  const introText = `${greeting} ${companyName} is ready to use.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Your team can receive funds through available business global accounts and use <strong>${escapeHtml(stablecoins)}</strong> wallets when ready.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      No funding transaction is required to make the account available.
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
        `${greeting} ${companyName} is ready to use.\n\n` +
        `Your team can receive funds through available business global accounts and use ${stablecoins} wallets when ready.\n` +
        "No funding transaction is required to make the account available.",
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
