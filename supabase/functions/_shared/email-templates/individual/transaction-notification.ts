import { htmlLayout, textLayout, firstName, escapeHtml, fmtMoney, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface TransactionNotificationProps {
  full_name?:    string;
  direction:     "credit" | "debit";
  amount:        number;
  currency:      string;
  reference:     string;
  description?:  string;
  new_balance?:  number;
  occurred_at?:  string;
}

export function render(p: TransactionNotificationProps): RenderedEmail {
  const fn          = firstName(p.full_name);
  const isCredit    = p.direction === "credit";
  const headline    = `${isCredit ? "Money in" : "Money out"} — ${fmtMoney(p.amount, p.currency)}`;
  const subject     = `${isCredit ? "Received" : "Sent"} ${fmtMoney(p.amount, p.currency)} on BorderPay`;
  const heading     = headline;
  const occurredAt  = p.occurred_at ? new Date(p.occurred_at).toUTCString() : new Date().toUTCString();
  const accentColor = isCredit ? BORDERPAY_BRAND.success : BORDERPAY_BRAND.warning;
  const balanceLine = p.new_balance != null
    ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">New balance</td>
       <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(fmtMoney(p.new_balance, p.currency))}</td></tr>`
    : "";

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:16px;margin:8px 0 0;">
      <tr>
        <td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Amount</td>
        <td style="padding:8px 0;color:${accentColor};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">
          ${isCredit ? "+" : "−"}${escapeHtml(fmtMoney(p.amount, p.currency))}
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Reference</td>
        <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(p.reference)}</td>
      </tr>
      ${p.description ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Description</td>
        <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(p.description)}</td></tr>` : ""}
      <tr>
        <td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">When</td>
        <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(occurredAt)}</td>
      </tr>
      ${balanceLine}
    </table>`;

  const ctaUrl = `${BORDERPAY_BRAND.appUrl}/transactions`;
  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading,
      introText: isCredit ? `Hi ${fn}, your wallet just received funds.` : `Hi ${fn}, here's a receipt for your transaction.`,
      body,
      ctaText: "Open BorderPay",
      ctaUrl,
      footerNote: "Didn't recognise this transaction? Reply to this email or contact support immediately.",
    }),
    text: textLayout({
      heading,
      body: `${isCredit ? "Received" : "Sent"} ${fmtMoney(p.amount, p.currency)}\nReference: ${p.reference}\n${p.description ? "Description: " + p.description + "\n" : ""}When: ${occurredAt}${p.new_balance != null ? "\nNew balance: " + fmtMoney(p.new_balance, p.currency) : ""}`,
      ctaText: "Open BorderPay",
      ctaUrl,
    }),
  };
}
