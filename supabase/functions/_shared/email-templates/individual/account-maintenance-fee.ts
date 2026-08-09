import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface IndividualAccountMaintenanceFeeProps {
  full_name?: string;
  billing_start_date: string;
}

export function render(p: IndividualAccountMaintenanceFeeProps): RenderedEmail {
  const name = firstName(p.full_name) || "there";
  const billingDate = String(p.billing_start_date || "the end of this month");
  const body = `
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      Your verified BorderPay Individual account has a <strong>$5 monthly account maintenance fee</strong>.
    </p>
    <div style="margin:0 0 16px;padding:16px;border:1px solid ${BORDERPAY_BRAND.border};background:#FFFFFF;">
      <strong style="color:${BORDERPAY_BRAND.text};">Individual account: $5/month</strong><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">First billing date: ${escapeHtml(billingDate)}</span>
    </div>
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      The fee maintains wallet infrastructure, receiving-account infrastructure, platform services, and customer support. It will be deducted internally from your available USDC balance first, then USDT if needed. BorderPay will not make an on-chain transfer for this fee.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      If your balance is insufficient on the billing date, we will notify you to fund your wallet. Your funds remain secure.
    </p>`;

  return {
    subject: "Your BorderPay Individual Account Maintenance Fee",
    html: htmlLayout({
      preview: "Your verified Individual account maintenance fee is $5 per month.",
      heading: "Individual account maintenance",
      introText: "Monthly billing begins at the end of the month.",
      body,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
    text: textLayout({
      heading: "Your BorderPay Individual Account Maintenance Fee",
      body: `Hi ${name},\n\nYour verified BorderPay Individual account has a $5 monthly account maintenance fee.\n\nFirst billing date: ${billingDate}\n\nThe fee maintains wallet infrastructure, receiving-account infrastructure, platform services, and customer support. It will be deducted internally from your available USDC balance first, then USDT if needed. BorderPay will not make an on-chain transfer for this fee.\n\nIf your balance is insufficient on the billing date, we will notify you to fund your wallet. Your funds remain secure.`,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
