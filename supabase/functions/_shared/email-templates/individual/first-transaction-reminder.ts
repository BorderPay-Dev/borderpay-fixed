import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

interface Props {
  full_name?: string;
  minimum_deposit?: string;
  stablecoins?: string;
  action_url?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const fullName = String(props.full_name || "").trim() || "there";
  const minimumDeposit = String(props.minimum_deposit || "$20").trim();
  const stablecoins = String(props.stablecoins || "USDC/USDT").trim();
  const actionUrl = String(props.action_url || "https://app.borderpayafrica.com").trim();
  const subject = "Make your first transaction to unlock your global accounts";
  const heading = "Unlock your global accounts";
  const introText = `Hi ${fullName}, your account is almost ready.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Make your first transfer or deposit of at least <strong>${escapeHtml(minimumDeposit)}</strong> in <strong>${escapeHtml(stablecoins)}</strong>.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Once completed, your USD, EUR, and GBP receive accounts unlock automatically.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      This is not an activation fee. Your funds stay in your wallet and remain available to use. No hidden charges.
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
      footerNote: "If you need help, contact support from your BorderPay app.",
    }),
    text: textLayout({
      heading,
      body:
        `Hi ${fullName}, your account is almost ready.\n\n` +
        `Make your first transfer or deposit of at least ${minimumDeposit} in ${stablecoins}.\n` +
        "Once completed, your USD, EUR, and GBP receive accounts unlock automatically.\n\n" +
        "This is not an activation fee. Your funds stay in your wallet. No hidden charges.",
      ctaText: "Open BorderPay",
      ctaUrl: actionUrl,
      footerNote: "If you need help, contact support from your BorderPay app.",
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
