import { htmlLayout, textLayout, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

interface Props {
  full_name?: string;
  stablecoins?: string;
  action_url?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const fullName = String(props.full_name || "").trim() || "there";
  const stablecoins = String(props.stablecoins || "USDC/USDT").trim();
  const actionUrl = String(props.action_url || "https://app.borderpayafrica.com").trim();
  const subject = "Your BorderPay account is ready";
  const heading = "Your global accounts are ready";
  const introText = `Hi ${fullName}, your account is ready to use.`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      You can receive funds through your available global accounts and use your <strong>${escapeHtml(stablecoins)}</strong> wallet when you are ready.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      No funding transaction is required to make your account available.
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
        `Hi ${fullName}, your account is ready to use.\n\n` +
        `You can receive funds through your available global accounts and use your ${stablecoins} wallet when you are ready.\n` +
        "No funding transaction is required to make your account available.",
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
