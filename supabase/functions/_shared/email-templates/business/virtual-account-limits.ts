import { htmlLayout, textLayout, BORDERPAY_BRAND, escapeHtml, RenderedEmail } from "../layout.ts";

export interface BusinessVirtualAccountLimitsProps {
  company_name?: string;
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

export function render(p: BusinessVirtualAccountLimitsProps): RenderedEmail {
  const company = String(p.company_name || "your business");
  const accounts = Array.isArray(p.virtual_accounts) ? p.virtual_accounts : [];
  const subject = `${company}: active global account limits`;
  const heading = "Active business global account limits";
  const introText = `${company} can use the active BorderPay global receive accounts below for supported business payments.`;
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
      USD, EUR, and GBP accounts are receive rails for approved business payments into BorderPay. They are not card balances, and they are not spendable wallets by themselves.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      ${accountRows}
    </table>
    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">Supported receive usage</div>
      <ul style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li><strong style="color:#111111;">USD ACH:</strong> own-account business payments, business/client payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000. Person-to-person payments from New York or Texas are not supported.</li>
        <li><strong style="color:#111111;">EUR SEPA:</strong> own-account business payments and business/client payments are supported. If an individual wants to send EUR by SEPA, contact BorderPay before they pay so we can review the route and help avoid a preventable refund. Payments over EUR 1,000,000 may use SEPA Credit and can take 1 business day.</li>
        <li><strong style="color:#111111;">GBP Faster Payments:</strong> own-account business payments and business/client payments are supported. Incoming payments from individuals are not supported. Payments over GBP 1,000,000 may use BACS and can take 3 business days.</li>
      </ul>
    </div>
    <div style="margin:0 0 16px;padding:14px;border:1px solid #D8DED8;border-radius:10px;background:#FFFFFF;text-align:left;">
      <div style="color:#111111;font-size:14px;font-weight:800;margin-bottom:8px;">Before your business shares account details</div>
      <ol style="margin:0;padding-left:18px;color:#111111;font-size:13px;line-height:1.65;">
        <li>Use the exact business account holder name and account details shown in BorderPay.</li>
        <li>Confirm the sender is a supported business, client, platform, employer, or own-account sender.</li>
        <li>For GBP, do not receive individual-to-individual third-party payments. GBP is for business payment use only.</li>
        <li>Contact support before a large, unusual, first-time payment, or before receiving EUR SEPA from an individual.</li>
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
    "USD, EUR, and GBP accounts are receive rails for approved business payments into BorderPay. They are not card balances, and they are not spendable wallets by themselves.",
    accountText,
    "Supported receive usage:\nUSD ACH: own-account business payments, business/client payments, payroll, family payments with the same surname, and eligible person-to-person payments under $4,000. Person-to-person payments from New York or Texas are not supported.\nEUR SEPA: own-account business payments and business/client payments are supported. If an individual wants to send EUR by SEPA, contact BorderPay before they pay so we can review the route and help avoid a preventable refund. Payments over EUR 1,000,000 may use SEPA Credit and can take 1 business day.\nGBP Faster Payments: own-account business payments and business/client payments are supported. Incoming payments from individuals are not supported. Payments over GBP 1,000,000 may use BACS and can take 3 business days.",
    "Before your business shares account details:\n1. Use the exact business account holder name and account details shown in BorderPay.\n2. Confirm the sender is a supported business, client, platform, employer, or own-account sender.\n3. For GBP, do not receive individual-to-individual third-party payments. GBP is for business payment use only.\n4. Contact support before a large, unusual, first-time payment, or before receiving EUR SEPA from an individual.",
    "Payments can still be reviewed before funds are released. If a sender type is unsupported or a rail rule is not followed, the payment may be refunded to the original sender. Contact BorderPay first when a payment does not clearly match the rules above.",
  ].join("\n\n");

  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText,
      body,
      ctaText: "Open business dashboard",
      ctaUrl,
      footerNote: "For help with incoming business payments, reply to this email or contact BorderPay support.",
      brandTone: "warning",
      surface: "clean",
    }),
    text: textLayout({
      heading,
      body: textBody,
      ctaText: "Open business dashboard",
      ctaUrl,
      footerNote: "For help with incoming business payments, reply to this email or contact BorderPay support.",
    }),
  };
}
