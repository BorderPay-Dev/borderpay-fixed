import { htmlLayout, textLayout, escapeHtml, fmtMoney, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface TransactionNotificationProps {
  company_name:  string;
  direction:     "credit" | "debit";
  amount:        number;
  currency:      string;
  reference:     string;
  description?:  string;
  counterparty?: string;
  new_balance?:  number;
  occurred_at?:  string;
}

export function render(p: TransactionNotificationProps): RenderedEmail {
  const company  = p.company_name || "your business";
  const isCredit = p.direction === "credit";
  const amountStr = fmtMoney(p.amount, p.currency);
  const subject  = `${company}: ${isCredit ? "received" : "sent"} ${amountStr}`;
  const heading  = `${isCredit ? "Money in" : "Money out"} — ${amountStr}`;
  const occurredAt = p.occurred_at ? new Date(p.occurred_at).toUTCString() : new Date().toUTCString();
  const accentColor = isCredit ? BORDERPAY_BRAND.success : BORDERPAY_BRAND.warning;

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:16px;margin:8px 0 0;">
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Account</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(company)}</td></tr>
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Amount</td>
          <td style="padding:8px 0;color:${accentColor};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">
            ${isCredit ? "+" : "−"}${escapeHtml(amountStr)}
          </td></tr>
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Reference</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(p.reference)}</td></tr>
      ${p.counterparty ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${isCredit ? "From" : "To"}</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(p.counterparty)}</td></tr>` : ""}
      ${p.description ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Description</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(p.description)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">When</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(occurredAt)}</td></tr>
      ${p.new_balance != null ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">New balance</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(fmtMoney(p.new_balance, p.currency))}</td></tr>` : ""}
    </table>`;

  const ctaUrl = `${BORDERPAY_BRAND.appUrl}/transactions`;
  return {
    subject,
    html: htmlLayout({
      preview: subject, heading,
      introText: isCredit
        ? `${company} just received funds.`
        : `${company} just sent a payment. Receipt below.`,
      body, ctaText: "Open BorderPay", ctaUrl,
      footerNote: "Didn't recognise this? Reply to this email or contact support immediately.",
    }),
    text: textLayout({
      heading,
      body: `${company}\n${isCredit ? "Received" : "Sent"} ${amountStr}\nReference: ${p.reference}\n${p.counterparty ? (isCredit ? "From" : "To") + ": " + p.counterparty + "\n" : ""}When: ${occurredAt}${p.new_balance != null ? "\nNew balance: " + fmtMoney(p.new_balance, p.currency) : ""}`,
      ctaText: "Open BorderPay", ctaUrl,
    }),
  };
}
