import { BORDERPAY_BRAND, escapeHtml, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface BusinessAccountMaintenanceFeeProps {
  company_name?: string;
  billing_start_date: string;
}

export function render(p: BusinessAccountMaintenanceFeeProps): RenderedEmail {
  const company = String(p.company_name || "Your business");
  const billingDate = String(p.billing_start_date || "the end of this month");
  const body = `
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">Hello ${escapeHtml(company)},</p>
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      Your verified BorderPay Business account has a <strong>$15 monthly account maintenance fee</strong>.
    </p>
    <div style="margin:0 0 16px;padding:16px;border:1px solid ${BORDERPAY_BRAND.border};background:#FFFFFF;">
      <strong style="color:${BORDERPAY_BRAND.text};">Business account: $15/month</strong><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">First billing date: ${escapeHtml(billingDate)}</span>
    </div>
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      The fee maintains business wallet infrastructure, receiving-account infrastructure, platform services, and customer support. It will be deducted internally from your available USDC balance first, then USDT if needed. BorderPay will not make an on-chain transfer for this fee.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      If your balance is insufficient on the billing date, we will notify you to fund your wallet. Your funds remain secure.
    </p>`;

  return {
    subject: "Your BorderPay Business Account Maintenance Fee",
    html: htmlLayout({
      preview: "Your verified Business account maintenance fee is $15 per month.",
      heading: "Business account maintenance",
      introText: "Monthly billing begins at the end of the month.",
      body,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
    text: textLayout({
      heading: "Your BorderPay Business Account Maintenance Fee",
      body: `Hello ${company},\n\nYour verified BorderPay Business account has a $15 monthly account maintenance fee.\n\nFirst billing date: ${billingDate}\n\nThe fee maintains business wallet infrastructure, receiving-account infrastructure, platform services, and customer support. It will be deducted internally from your available USDC balance first, then USDT if needed. BorderPay will not make an on-chain transfer for this fee.\n\nIf your balance is insufficient on the billing date, we will notify you to fund your wallet. Your funds remain secure.`,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
