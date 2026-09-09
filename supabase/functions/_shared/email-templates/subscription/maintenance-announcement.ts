import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string;
  billing_start_date: string;
  account_type: "individual" | "business";
}

export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const business = p.account_type === "business";
  const accountLabel = business ? "Business" : "Individual";
  const fee = business ? "$29.99" : "$5";
  const body = `
    <p>Dear ${escapeHtml(name)},</p>
    <p>This notice applies only to your verified ${accountLabel} account.</p>
    <div style="border:1px solid ${BORDERPAY_BRAND.border};padding:16px;margin:20px 0;">
      <strong>${accountLabel} Account Maintenance: ${fee}/month</strong><br />
      Billing date: <strong>${escapeHtml(p.billing_start_date)}</strong>
    </div>
    <p>The fee is deducted from an available BorderPay USDC or USDT wallet balance.</p>`;
  return {
    subject: `BorderPay ${accountLabel} account maintenance`,
    html: htmlLayout({ heading: `${accountLabel} account maintenance`, body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
    text: textLayout({ heading: `BorderPay ${accountLabel} account maintenance`, body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
  };
}
