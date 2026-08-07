import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props { customer_name?: string; billing_start_date: string; }

export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const body = `
    <p>Dear ${escapeHtml(name)},</p>
    <p>We hope you are doing well.</p>
    <p>Thank you for being part of BorderPay. As we continue expanding our global payment infrastructure and improving our platform, we are introducing a monthly account maintenance fee for verified accounts.</p>
    <p>This fee allows us to continue providing reliable access to:</p>
    <p>✓ Multi-currency wallets<br />✓ Global receiving accounts (where available)<br />✓ USDC and USDT wallet infrastructure<br />✓ Secure cross-border payments<br />✓ Ongoing platform maintenance and support</p>
    <div style="border:1px solid ${BORDERPAY_BRAND.border};padding:16px;margin:20px 0;">
      <strong>New Monthly Account Maintenance Fee</strong><br /><br />
      Individual Accounts: <strong>$5/month</strong><br />
      Business Accounts: <strong>$15/month</strong><br /><br />
      Your first billing cycle will begin on: <strong>${escapeHtml(p.billing_start_date)}</strong>
    </div>
    <p>The fee will be automatically deducted from your BorderPay wallet balance in USDC or USDT.</p>
    <p><strong>What happens if your balance is insufficient?</strong></p>
    <p>If your wallet does not have enough funds available at the billing date, your subscription payment will remain pending. You will receive a notification requesting you to fund your wallet. Certain account features, including new receiving-account access and payment functionality, may be temporarily restricted after the grace period until the maintenance fee is completed.</p>
    <p>Your funds remain secure, and you can restore full access at any time by funding your BorderPay wallet.</p>
    <p>We appreciate your continued trust as we build BorderPay into a global financial platform connecting businesses, freelancers, and individuals across Africa and worldwide.</p>
    <p>If you have any questions, our support team is available to assist you.</p>
    <p>Thank you for choosing BorderPay.</p>
    <p>Kind regards,<br />BorderPay Team</p>`;
  return {
    subject: "BorderPay Account Maintenance Fee Update",
    html: htmlLayout({ heading: "Account maintenance update", preview: "Monthly account maintenance begins at the end of the month.", body, ctaText: "Open BorderPay", ctaUrl: BORDERPAY_BRAND.appUrl }),
    text: textLayout({ heading: "BorderPay Account Maintenance Fee Update", body }),
  };
}
