import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string;
  billing_start_date?: string;
  effective_date?: string;
}

export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const effectiveDate = p.effective_date || "September 1, 2026";
  const nextBillingDate = p.billing_start_date || "your first billing date on or after September 1, 2026";
  const body = `
    <p>Dear ${escapeHtml(name)},</p>
    <p>Starting <strong>${escapeHtml(effectiveDate)}</strong>, BorderPay Business account maintenance will change from <strong>$15.00</strong> to <strong>$29.99 per month</strong>.</p>
    <p>Your August 2026 maintenance charge remains <strong>$15.00</strong>. The new price applies only to Business billing periods on or after September 1, 2026. Your next applicable billing date is <strong>${escapeHtml(nextBillingDate)}</strong>.</p>
    <p>The updated fee supports the operating and compliance infrastructure behind verified Business accounts, including:</p>
    <ul>
      <li>Up to 3 eligible virtual accounts</li>
      <li>Business wallet and treasury infrastructure</li>
      <li>Global and African payment connectivity where available</li>
      <li>Security, compliance operations, monitoring, and support</li>
    </ul>
    <div style="border:1px solid ${BORDERPAY_BRAND.border};padding:16px;margin:20px 0;">
      <strong>BorderPay Business</strong><br /><br />
      Account opening: Free<br />
      KYB onboarding: Free<br />
      Corporate account maintenance: <strong>$29.99/month from September 1, 2026</strong><br />
      Up to 3 eligible virtual accounts: Included<br />
      Transactions, FX, and additional services: Applicable fees
    </div>
    <p>This change applies only to verified Business accounts.</p>
    <p>Kind regards,<br />BorderPay Team</p>`;
  return {
    subject: "BorderPay Business maintenance fee update — effective September 1, 2026",
    html: htmlLayout({ heading: "Business maintenance fee update", preview: "Your August fee remains $15. The new Business fee begins in September.", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
    text: textLayout({ heading: "BorderPay Business maintenance fee update", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
  };
}
