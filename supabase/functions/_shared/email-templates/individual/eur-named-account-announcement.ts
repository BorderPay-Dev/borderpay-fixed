import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props { full_name?: string }

export function render(p: Props): RenderedEmail {
  const name = firstName(p.full_name);
  const body = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Starting <strong>September 2, 2026</strong>, your name will appear as the account-holder name on eligible BorderPay EUR account details and outgoing EUR payments.</p>
    <div style="border:1px solid ${BORDERPAY_BRAND.border};padding:16px;margin:20px 0;">
      <strong>Your EUR IBAN is not changing.</strong><br /><br />
      You can continue using the same account details. Pricing is also unchanged.
    </div>
    <p><strong>Maintenance window:</strong> September 2, 2026, from 8:00 AM to 2:00 PM Eastern Time. EUR deposits and payouts may be delayed during this window and for up to 12 hours afterward. Incoming deposits will still be received and will process after the upgrade completes.</p>
    <p><strong>What you need to do:</strong></p>
    <ul>
      <li>Ask anyone sending EUR to use your name as the beneficiary—not Bridge's name.</li>
      <li>Refresh any saved deposit instructions after the upgrade.</li>
      <li>If a recipient allowlists sender names, ask them to expect your name on future EUR payouts.</li>
    </ul>
    <p>Deposits addressed to Bridge will continue to be accepted during a 30-day transition period, but a name mismatch after that period may cause a risk-related rejection.</p>
    <p>Need help? Contact <a href="mailto:support@borderpayafrica.com">support@borderpayafrica.com</a>.</p>
    <p>Kind regards,<br />BorderPay Operations</p>`;
  return {
    subject: "Action required: your EUR account name changes September 2",
    html: htmlLayout({ heading: "EUR account-holder name update", preview: "Your IBAN and pricing are unchanged. Update the beneficiary name used for EUR payments.", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
    text: textLayout({ heading: "EUR account-holder name update", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.smartAppUrl }),
  };
}
