import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string;
  account_type: "individual" | "business";
  monthly_fee: number;
  billing_start_date: string;
}

export function render(p: Props): RenderedEmail {
  const business = p.account_type === "business";
  const label = business ? "Business" : "Individual";
  const name = firstName(p.customer_name);
  const features = business
    ? ["Multi-currency business wallets", "Treasury management", "Bulk payouts and payroll", "Team management", "Receiving accounts", "USDC and USDT wallets"]
    : ["Multi-currency wallet", "USDC and USDT wallets", "Receiving accounts where available", "Cross-border payments"];
  const body = `
    <p>Welcome, ${escapeHtml(name)}. Your verified ${label.toLowerCase()} account is now active.</p>
    <ul>${features.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
    <div style="border:1px solid ${BORDERPAY_BRAND.border};padding:16px;margin:20px 0;">
      <strong>${label} Account Maintenance: $${Number(p.monthly_fee).toFixed(0)}/month</strong><br />
      <span>The fee maintains wallet infrastructure, receiving-account infrastructure, platform services, and customer support.</span><br />
      <span>First billing date: ${escapeHtml(p.billing_start_date)}</span>
    </div>`;
  return {
    subject: `Your BorderPay ${label} Account Has Been Verified`,
    html: htmlLayout({ heading: `Your ${label} account is verified`, introText: `Welcome to BorderPay, ${name}.`, body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl }),
    text: textLayout({ heading: `Your BorderPay ${label} Account Has Been Verified`, body: `${body}` }),
  };
}
