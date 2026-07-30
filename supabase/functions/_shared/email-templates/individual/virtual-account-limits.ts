import { htmlLayout, textLayout, BORDERPAY_BRAND, firstName, escapeHtml, RenderedEmail } from "../layout.ts";

export interface IndividualVirtualAccountLimitsProps {
  full_name?: string;
  action_url?: string;
  virtual_accounts?: Array<{
    currency?: string;
    rail?: string;
    account_label?: string;
    minimum?: string;
    maximum?: string;
    accepted_payments?: string;
    important_note?: string;
  }>;
}

export function render(p: IndividualVirtualAccountLimitsProps): RenderedEmail {
  const name = firstName(p.full_name);
  const accounts = Array.isArray(p.virtual_accounts) ? p.virtual_accounts : [];
  const subject = "Your active global account limits";
  const heading = "Your active global account limits";
  const introText = `Hello ${name}, here is how to use your active BorderPay global receive accounts safely.`;
  const ctaUrl = String(p.action_url || `${BORDERPAY_BRAND.appUrl}/dashboard`);
  const accountRows = accounts.length > 0
    ? accounts.map((account) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BORDERPAY_BRAND.border};vertical-align:top;">
          <div style="color:#111111;font-size:14px;font-weight:700;">${escapeHtml(String(account.account_label || account.currency || "Global account"))}</div>
          <div style="margin-top:6px;color:#111111;font-size:13px;line-height:1.55;">
            Minimum: ${escapeHtml(String(account.minimum || "Shown in your account"))}<br />
            Maximum: ${escapeHtml(String(account.maximum || "Shown in your account"))}<br />
            Accepted payments: ${escapeHtml(String(account.accepted_payments || "Supported payments depend on your account currency and rail."))}<br />
            Note: ${escapeHtml(String(account.important_note || "Contact support before receiving a large payment."))}
          </div>
        </td>
      </tr>
    `).join("")
    : `
      <tr>
        <td style="padding:10px 0;color:#111111;font-size:13px;line-height:1.55;">
          No active global receive account details were included for this message.
        </td>
      </tr>
    `;

  const body = `
    <p style="margin:0 0 14px;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Your USD, EUR, and GBP accounts are receive rails. They are used to receive supported bank payments into BorderPay. They are not card balances, and they are not spendable wallets by themselves.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      ${accountRows}
    </table>
    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">How each account should be used</div>
      <ul style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li><strong style="color:#111111;">USD ACH:</strong> own-account payments, business payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000. Person-to-person payments from New York or Texas are not supported.</li>
        <li><strong style="color:#111111;">EUR SEPA:</strong> own-account payments and business payments are supported. If an individual wants to send you EUR by SEPA, contact BorderPay before they pay so we can review the route and help you avoid a preventable refund. Payments over EUR 1,000,000 may use SEPA Credit and can take 1 business day.</li>
        <li><strong style="color:#111111;">GBP Faster Payments:</strong> own-account payments and business payments are supported. Incoming payments from individuals are not supported. Payments over GBP 1,000,000 may use BACS and can take 3 business days.</li>
      </ul>
    </div>
    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">Before you share account details</div>
      <ol style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li>Check that the sender type is supported for that currency.</li>
        <li>Use the exact account holder name and account details shown in BorderPay.</li>
        <li>For GBP, share the account with businesses, employers, platforms, or clients only. Do not use GBP for individual-to-individual third-party payments.</li>
        <li>Contact support before a large or unusual payment, or before receiving EUR SEPA from an individual.</li>
      </ol>
    </div>
    <p style="margin:0;color:#111111;font-size:14px;line-height:1.65;text-align:left;">
      Payments can still be reviewed before funds are released. If a sender type is unsupported or a rail rule is not followed, the payment may be refunded to the original sender. Contact BorderPay first when a payment does not clearly match the rules above.
    </p>
  `;

  const accountText = accounts.length > 0
    ? accounts.map((account) => [
      `${account.account_label || account.currency || "Global account"}`,
      `Minimum: ${account.minimum || "Shown in your account"}`,
      `Maximum: ${account.maximum || "Shown in your account"}`,
      `Accepted payments: ${account.accepted_payments || "Supported payments depend on your account currency and rail."}`,
      `Note: ${account.important_note || "Contact support before receiving a large payment."}`,
    ].join("\n")).join("\n\n")
    : "No active global receive account details were included for this message.";
  const textBody = [
    introText,
    "Your USD, EUR, and GBP accounts are receive rails. They are used to receive supported bank payments into BorderPay. They are not card balances, and they are not spendable wallets by themselves.",
    accountText,
    "How each account should be used:\nUSD ACH: own-account payments, business payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000. Person-to-person payments from New York or Texas are not supported.\nEUR SEPA: own-account payments and business payments are supported. If an individual wants to send you EUR by SEPA, contact BorderPay before they pay so we can review the route and help you avoid a preventable refund. Payments over EUR 1,000,000 may use SEPA Credit and can take 1 business day.\nGBP Faster Payments: own-account payments and business payments are supported. Incoming payments from individuals are not supported. Payments over GBP 1,000,000 may use BACS and can take 3 business days.",
    "Before you share account details:\n1. Check that the sender type is supported for that currency.\n2. Use the exact account holder name and account details shown in BorderPay.\n3. For GBP, share the account with businesses, employers, platforms, or clients only. Do not use GBP for individual-to-individual third-party payments.\n4. Contact support before a large or unusual payment, or before receiving EUR SEPA from an individual.",
    "Payments can still be reviewed before funds are released. If a sender type is unsupported or a rail rule is not followed, the payment may be refunded to the original sender. Contact BorderPay first when a payment does not clearly match the rules above.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open BorderPay",
      ctaUrl,
      footerNote: "For help with an incoming payment, reply to this email or contact BorderPay support.",
      brandTone: "warning",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Open BorderPay",
      ctaUrl,
      footerNote: "For help with an incoming payment, reply to this email or contact BorderPay support.",
    }),
  };
}
