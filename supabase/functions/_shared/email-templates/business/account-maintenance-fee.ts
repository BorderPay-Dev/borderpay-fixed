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
      Your active BorderPay Business account has a <strong>$29.99 monthly account maintenance fee</strong>.
    </p>
    <div style="margin:0 0 16px;padding:16px;border:1px solid ${BORDERPAY_BRAND.border};background:#FFFFFF;">
      <strong style="color:${BORDERPAY_BRAND.text};">Business account: $29.99/month</strong><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">First billing date: ${escapeHtml(billingDate)}</span>
    </div>
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      Billing applies while at least one BorderPay receiving account is active. Your invoice and payment status are available securely in BorderPay.
    </p>
    <p style="margin:0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">
      If every receiving account is deactivated, recurring billing is paused until account activation.
    </p>`;

  return {
    subject: "Your BorderPay Business Account Maintenance Fee",
    html: htmlLayout({
      preview: "Your active Business account maintenance fee is $29.99/month.",
      heading: "Business account maintenance",
      introText: "Monthly billing begins at the end of the month.",
      body,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
    text: textLayout({
      heading: "Your BorderPay Business Account Maintenance Fee",
      body: `Hello ${company},\n\nYour active BorderPay Business account has a $29.99 monthly account maintenance fee.\n\nFirst billing date: ${billingDate}\n\nBilling applies while at least one BorderPay receiving account is active. Your invoice and payment status are available securely in BorderPay. If every receiving account is deactivated, recurring billing is paused until account activation.`,
      ctaText: "Open BorderPay",
      ctaUrl: BORDERPAY_BRAND.appUrl,
    }),
  };
}
