import { htmlLayout, textLayout, firstName, escapeHtml, fmtMoney, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface TransactionStatusProps {
  full_name?: string | null;
  status: "in_review" | "approved" | "canceled" | "refunded" | "refund_in_flight";
  amount: number;
  currency: string;
  reference: string;
  description?: string | null;
  occurred_at?: string | null;
  gross_amount?: number | null;
  developer_fee_amount?: number | null;
  exchange_fee_amount?: number | null;
  net_amount?: number | null;
}

const COPY: Record<TransactionStatusProps["status"], { subject: string; heading: string; intro: string; tone: "default" | "warning" | "danger" }> = {
  in_review: {
    subject: "Transaction under review",
    heading: "Transaction under review",
    intro: "This transaction is under compliance review. We will notify you when the status changes.",
    tone: "warning",
  },
  approved: {
    subject: "Transaction approved",
    heading: "Transaction approved",
    intro: "This transaction has been approved and is now reflected in your BorderPay account.",
    tone: "default",
  },
  canceled: {
    subject: "Transaction canceled",
    heading: "Transaction canceled",
    intro: "This transaction was canceled and no funds were made available in your BorderPay account.",
    tone: "danger",
  },
  refund_in_flight: {
    subject: "Refund in progress",
    heading: "Refund in progress",
    intro: "This transaction is being returned. We will notify you once the refund is complete.",
    tone: "warning",
  },
  refunded: {
    subject: "Transaction refunded",
    heading: "Transaction refunded",
    intro: "This transaction was refunded and the funds are no longer available in your BorderPay account.",
    tone: "danger",
  },
};

export function render(p: TransactionStatusProps): RenderedEmail {
  const c = COPY[p.status] ?? COPY.in_review;
  const serviceFeeAmount = Number(p.developer_fee_amount ?? 0);
  const exchangeFeeAmount = Number(p.exchange_fee_amount ?? 0);
  const grossAmount = Number(p.gross_amount ?? p.amount);
  const netAmount = Number(p.net_amount ?? p.amount);
  const hasFeeBreakdown =
    Number.isFinite(grossAmount) &&
    Number.isFinite(netAmount) &&
    (serviceFeeAmount > 0 || exchangeFeeAmount > 0 || Math.abs(grossAmount - netAmount) > 0.000001);
  const amount = fmtMoney(hasFeeBreakdown ? netAmount : p.amount, p.currency);
  const gross = fmtMoney(grossAmount, p.currency);
  const serviceFee = fmtMoney(serviceFeeAmount, p.currency);
  const exchangeFee = fmtMoney(exchangeFeeAmount, p.currency);
  const subject = `${c.subject}: ${amount}`;
  const occurredAt = p.occurred_at ? new Date(p.occurred_at).toUTCString() : new Date().toUTCString();
  const fn = firstName(p.full_name);
  const amountRows = hasFeeBreakdown
    ? `
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Full amount received</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(gross)}</td></tr>
      ${serviceFeeAmount > 0 ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Service fee</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">-${escapeHtml(serviceFee)}</td></tr>` : ""}
      ${exchangeFeeAmount > 0 ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Exchange fee</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">-${escapeHtml(exchangeFee)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Net amount</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(amount)}</td></tr>`
    : `
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Amount</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(amount)}</td></tr>`;
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:16px;margin:8px 0 0;">
      ${amountRows}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Status</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(c.heading)}</td></tr>
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Reference</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(p.reference)}</td></tr>
      ${p.description ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Description</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(p.description)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">When</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(occurredAt)}</td></tr>
    </table>`;

  const ctaUrl = `${BORDERPAY_BRAND.appUrl}/transactions`;
  return {
    subject,
    html: htmlLayout({
      preview: subject,
      heading: c.heading,
      introText: `Hi ${fn}, ${c.intro}`,
      body,
      ctaText: "Open BorderPay",
      ctaUrl,
      brandTone: c.tone,
    }),
    text: textLayout({
      heading: c.heading,
      body: `${c.intro}\n${hasFeeBreakdown ? `Full amount received: ${gross}\n${serviceFeeAmount > 0 ? `Service fee: -${serviceFee}\n` : ""}${exchangeFeeAmount > 0 ? `Exchange fee: -${exchangeFee}\n` : ""}Net amount: ${amount}` : `Amount: ${amount}`}\nStatus: ${c.heading}\nReference: ${p.reference}\n${p.description ? "Description: " + p.description + "\n" : ""}When: ${occurredAt}`,
      ctaText: "Open BorderPay",
      ctaUrl,
    }),
  };
}
