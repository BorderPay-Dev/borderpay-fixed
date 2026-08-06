import { htmlLayout, textLayout, BORDERPAY_BRAND, escapeHtml, RenderedEmail } from "../layout.ts";

interface Props {
  full_name?: string;
  currency?: string;
  inactive_since?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const name = String(props.full_name || "there").trim();
  const currency = String(props.currency || "Your").trim().toUpperCase();
  const subject = `${currency} receiving account is inactive`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      Your ${escapeHtml(currency)} receiving account reached 30 days without receiving funds through a virtual account or your USDC/USDT wallet, so it has been deactivated.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      This does not close your BorderPay profile or remove your transaction history. The receiving account cannot accept new payments while inactive.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      When you are ready to use it again, contact support and our team will review the reactivation request.
    </p>`;
  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading: `${currency} receiving account inactive`,
      introText: `Hi ${name}, your receiving account has been placed in inactive status.`,
      body,
      ctaText: "Contact support",
      ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}?subject=${encodeURIComponent(`${currency} account reactivation request`)}`,
      brandTone: "warning",
    }),
    text: textLayout({
      heading: `${currency} receiving account inactive`,
      body: `Hi ${name}, your ${currency} receiving account reached 30 days without receiving funds through a virtual account or your USDC/USDT wallet, so it has been deactivated. This does not close your BorderPay profile or remove your transaction history. The receiving account cannot accept new payments while inactive. When you are ready to use it again, contact support for review.`,
      ctaText: "Contact support",
      ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}`,
    }),
  };
}
