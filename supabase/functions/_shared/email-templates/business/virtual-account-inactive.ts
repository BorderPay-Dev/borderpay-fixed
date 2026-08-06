import { htmlLayout, textLayout, BORDERPAY_BRAND, escapeHtml, RenderedEmail } from "../layout.ts";

interface Props {
  company_name?: string;
  currency?: string;
  inactive_since?: string;
}

export function render(props: Props = {}): RenderedEmail {
  const company = String(props.company_name || "your business").trim();
  const currency = String(props.currency || "Your").trim().toUpperCase();
  const subject = `${currency} business receiving account is inactive`;
  const body = `
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      The ${escapeHtml(currency)} receiving account for ${escapeHtml(company)} reached 30 days without receiving funds through a virtual account or USDC/USDT wallet, so it has been deactivated.
    </p>
    <p style="margin:0 0 12px;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      This does not close the BorderPay business profile or remove transaction history. The receiving account cannot accept new payments while inactive.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:14px;line-height:1.65;">
      When your business is ready to use it again, contact support and our team will review the reactivation request.
    </p>`;
  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading: `${currency} business receiving account inactive`,
      introText: `${company}, this receiving account has been placed in inactive status.`,
      body,
      ctaText: "Contact support",
      ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}?subject=${encodeURIComponent(`${currency} business account reactivation request`)}`,
      brandTone: "warning",
    }),
    text: textLayout({
      heading: `${currency} business receiving account inactive`,
      body: `The ${currency} receiving account for ${company} reached 30 days without receiving funds through a virtual account or USDC/USDT wallet, so it has been deactivated. This does not close the BorderPay business profile or remove transaction history. The receiving account cannot accept new payments while inactive. Contact support when your business is ready to request reactivation.`,
      ctaText: "Contact support",
      ctaUrl: `mailto:${BORDERPAY_BRAND.supportEmail}`,
    }),
  };
}
