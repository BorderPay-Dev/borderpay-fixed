import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props { customer_name?: string; billing_start_date: string; }

export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const body = `<p>Dear ${escapeHtml(name)},</p>
    <p>Your verified Individual account maintenance fee is <strong>$5 per month</strong>.</p>
    <p>Your next billing date is <strong>${escapeHtml(p.billing_start_date)}</strong>.</p>
    <p>This message applies only to your Individual account.</p>`;
  return {
    subject: "BorderPay Individual account maintenance",
    html: htmlLayout({ heading: "Individual account maintenance", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
    text: textLayout({ heading: "BorderPay Individual account maintenance", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
  };
}
