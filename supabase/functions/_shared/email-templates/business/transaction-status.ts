import { htmlLayout, textLayout, escapeHtml, fmtMoney, fmtReceiptMoney, BORDERPAY_BRAND, RenderedEmail } from "../layout.ts";

export interface TransactionStatusProps {
  company_name?: string | null;
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
  source_currency?: string | null;
  source_amount?: number | null;
  service_charge_amount?: number | null;
  available_amount?: number | null;
  destination_currency?: string | null;
  destination_amount?: number | null;
  exchange_rate?: number | null;
  destination_address?: string | null;
  destination_rail?: string | null;
  source_rail?: string | null;
  deposit_tx_hash?: string | null;
  destination_tx_hash?: string | null;
  deposit_id?: string | null;
  receipt_kind?: "money_in_conversion" | null;
  refund_return_reason?: string | null;
  refund_returned_at?: string | null;
  refund_risk_rejection_reason?: string | null;
  refund_rail?: string | null;
  refund_beneficiary_name?: string | null;
  refund_reference_id?: string | null;
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
    intro: "The payment has been refunded to the original destination.",
    tone: "danger",
  },
};

function formatUtcDateTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} at ${hh}:${mi}:${ss} UTC`;
}

export function render(p: TransactionStatusProps): RenderedEmail {
  const company = p.company_name || "your business";
  const c = COPY[p.status] ?? COPY.in_review;
  const transactionFeeAmount = Number(p.developer_fee_amount ?? 0);
  const exchangeFeeAmount = Number(p.exchange_fee_amount ?? 0);
  const grossAmount = Number(p.gross_amount ?? p.amount);
  const netAmount = Number(p.net_amount ?? p.amount);
  const hasFeeBreakdown =
    Number.isFinite(grossAmount) &&
    Number.isFinite(netAmount) &&
    (transactionFeeAmount > 0 || exchangeFeeAmount > 0 || Math.abs(grossAmount - netAmount) > 0.000001);
  const amount = fmtMoney(hasFeeBreakdown ? netAmount : p.amount, p.currency);
  const gross = fmtMoney(grossAmount, p.currency);
  const transactionFee = fmtMoney(transactionFeeAmount, p.currency);
  const exchangeFee = fmtMoney(exchangeFeeAmount, p.currency);
  const sourceCurrency = String(p.source_currency || p.currency || "").toUpperCase();
  const destinationCurrency = String(p.destination_currency || "").toUpperCase();
  const destinationAmount = Number(p.destination_amount);
  const sourceAmount = Number(p.source_amount ?? grossAmount);
  const serviceChargeAmount = Number(p.service_charge_amount ?? transactionFeeAmount);
  const serviceChargeReported = p.service_charge_amount != null || p.developer_fee_amount != null;
  const availableAmount = Number(p.available_amount ?? netAmount);
  const hasReceipt = Boolean(destinationCurrency && Number.isFinite(destinationAmount) && destinationAmount > 0);
  const isMoneyInConversion = hasReceipt && p.receipt_kind === "money_in_conversion";
  const outgoing = hasReceipt ? (isMoneyInConversion ? fmtReceiptMoney(destinationAmount, destinationCurrency) : fmtMoney(destinationAmount, destinationCurrency)) : amount;
  const destinationRail = String(p.destination_rail || "").trim().toLowerCase();
  const destinationRailLabel = destinationRail
    ? destinationRail.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
    : "";
  const walletAmount = destinationRailLabel ? `${outgoing} / ${destinationRailLabel}` : outgoing;
  const isApprovedReceipt = hasReceipt && p.status === "approved";
  const isRefund = p.status === "refunded";
  const displayHeading = isMoneyInConversion ? "Funds added to your wallet" : isApprovedReceipt ? "Your payment has been submitted!" : c.heading;
  const displayIntro = isMoneyInConversion
    ? `${company}: your incoming payment was converted and added to your BorderPay wallet.`
    : isApprovedReceipt ? "Expected same day" : `${company}: ${c.intro}`;
  const subject = isMoneyInConversion ? `${company}: funds received (${outgoing})` : isApprovedReceipt ? `${company}: payment submitted (${outgoing})` : `${company}: ${c.subject.toLowerCase()} (${outgoing})`;
  const occurredAt = p.occurred_at ? new Date(p.occurred_at).toUTCString() : new Date().toUTCString();
  const refundReturnedAt = formatUtcDateTime(p.refund_returned_at || p.occurred_at);
  const railText = p.source_rail ? ` through ${String(p.source_rail).toUpperCase()}` : "";
  const feeText = serviceChargeAmount > 0
    ? `A ${isMoneyInConversion ? fmtReceiptMoney(serviceChargeAmount, sourceCurrency) : fmtMoney(serviceChargeAmount, sourceCurrency)} transaction fee was applied.`
    : "No service charge was applied.";
  const destinationText = p.destination_address ? " to the destination shown below" : "";
  const receiptSummary = hasReceipt
    ? `We received ${isMoneyInConversion ? fmtReceiptMoney(sourceAmount, sourceCurrency) : fmtMoney(sourceAmount, sourceCurrency)}${railText} for ${company}. ${feeText} ${isMoneyInConversion ? `${walletAmount} was added to your wallet.` : `The available amount was converted and ${outgoing} was sent${destinationText}.`}`
    : "";
  const receiptRows = hasReceipt
    ? `
      ${p.deposit_id ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Deposit ID</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(p.deposit_id))}</td></tr>` : ""}
      ${p.deposit_tx_hash ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Deposit tracking ID</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(p.deposit_tx_hash))}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Incoming funds</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(isMoneyInConversion ? fmtReceiptMoney(sourceAmount, sourceCurrency) : fmtMoney(sourceAmount, sourceCurrency))}</td></tr>
      ${p.source_rail ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Payment rail</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(String(p.source_rail).toUpperCase())}</td></tr>` : ""}
      ${serviceChargeReported ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Transaction fee</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${serviceChargeAmount > 0 ? `-${escapeHtml(isMoneyInConversion ? fmtReceiptMoney(serviceChargeAmount, sourceCurrency) : fmtMoney(serviceChargeAmount, sourceCurrency))}` : "Free"}<br /><span style="font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:${BORDERPAY_BRAND.textMuted};font-size:11px;">BorderPay</span></td></tr>` : ""}
      ${isMoneyInConversion ? "" : `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Available for conversion</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(fmtMoney(availableAmount, sourceCurrency))}</td></tr>`}
      ${Number.isFinite(Number(p.exchange_rate)) && Number(p.exchange_rate) > 0 ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Exchange rate</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">1 ${escapeHtml(sourceCurrency)} = ${escapeHtml(String(p.exchange_rate))} ${escapeHtml(destinationCurrency)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">${isMoneyInConversion ? "Converted amount / added to wallet" : "Outgoing funds"}</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(isMoneyInConversion ? walletAmount : outgoing)}</td></tr>
      ${p.destination_address ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Destination</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(p.destination_address))}</td></tr>` : ""}
      ${p.destination_tx_hash ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Destination tracking ID</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(p.destination_tx_hash))}</td></tr>` : ""}`
    : null;
  const amountRows = hasFeeBreakdown
    ? `
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Full amount received</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(gross)}</td></tr>
      ${transactionFeeAmount > 0 ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Transaction fee</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">-${escapeHtml(transactionFee)}</td></tr>` : ""}
      ${exchangeFeeAmount > 0 ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Exchange fee</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-family:'DM Mono',monospace;text-align:right;">-${escapeHtml(exchangeFee)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Net amount</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(amount)}</td></tr>`
    : `
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Amount</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;">${escapeHtml(amount)}</td></tr>`;
  const refundRows = isRefund
    ? `
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Return reason</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(String(p.refund_return_reason || p.description || "Payment refunded"))}</td></tr>
      ${refundReturnedAt ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Returned at</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(refundReturnedAt)}</td></tr>` : ""}
      ${p.refund_risk_rejection_reason ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Risk rejection reason</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(String(p.refund_risk_rejection_reason))}</td></tr>` : ""}
      <tr><td colspan="2" style="padding:10px 0;color:${BORDERPAY_BRAND.text};font-size:13px;line-height:1.6;">The payment has been refunded to the original destination.</td></tr>
      ${p.refund_rail ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Refund rail</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(String(p.refund_rail))}</td></tr>` : ""}
      ${p.refund_beneficiary_name ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Refund beneficiary name</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(String(p.refund_beneficiary_name))}</td></tr>` : ""}
      ${p.refund_reference_id ? `<tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Refund reference ID</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:12px;font-family:'DM Mono',monospace;text-align:right;word-break:break-all;">${escapeHtml(String(p.refund_reference_id))}</td></tr>` : ""}`
    : "";
  const body = `
    ${hasReceipt ? `
      <div style="border:1px solid ${BORDERPAY_BRAND.border};background-color:#F8FAF8;border-radius:12px;padding:14px 16px;margin:0 0 14px;">
        <p style="margin:0 0 6px;color:${BORDERPAY_BRAND.text};font-size:14px;font-weight:700;">${escapeHtml(p.deposit_id ? `Deposit #${p.deposit_id}` : "Payment receipt")}</p>
        <p style="margin:0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;line-height:1.6;">${isMoneyInConversion ? escapeHtml(receiptSummary) : isApprovedReceipt ? "Expected same day" : escapeHtml(receiptSummary)}</p>
      </div>
    ` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDERPAY_BRAND.border};border-radius:12px;padding:16px;margin:8px 0 0;">
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Account</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(company)}</td></tr>
      ${refundRows}
      ${receiptRows || amountRows}
      <tr><td style="padding:8px 0;color:${BORDERPAY_BRAND.textMuted};font-size:13px;">Status</td>
          <td style="padding:8px 0;color:${BORDERPAY_BRAND.text};font-size:13px;text-align:right;">${escapeHtml(isMoneyInConversion ? "Approved / Completed" : displayHeading)}</td></tr>
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
      heading: displayHeading,
      introText: hasReceipt ? displayIntro : `${company}: ${c.intro}`,
      body,
      ctaText: "Open BorderPay",
      ctaUrl,
      brandTone: c.tone,
      surface: isMoneyInConversion ? "clean" : "default",
    }),
    text: textLayout({
      heading: displayHeading,
      body: hasReceipt
        ? `${company}\n${displayHeading}\n\n${isRefund ? `Return reason: ${p.refund_return_reason || p.description || "Payment refunded"}\n${refundReturnedAt ? `Returned at: ${refundReturnedAt}\n` : ""}${p.refund_risk_rejection_reason ? `Risk rejection reason: ${p.refund_risk_rejection_reason}\n` : ""}The payment has been refunded to the original destination.\n${p.refund_rail ? `Refund rail: ${p.refund_rail}\n` : ""}${p.refund_beneficiary_name ? `Refund beneficiary name: ${p.refund_beneficiary_name}\n` : ""}${p.refund_reference_id ? `Refund reference ID: ${p.refund_reference_id}\n` : ""}` : (isMoneyInConversion ? receiptSummary : isApprovedReceipt ? "Expected same day" : `What this means: ${receiptSummary}`)}\n\n${p.deposit_id ? `Deposit #${p.deposit_id}\n` : ""}Incoming funds: ${isMoneyInConversion ? fmtReceiptMoney(sourceAmount, sourceCurrency) : fmtMoney(sourceAmount, sourceCurrency)}\n${p.source_rail ? `Payment rail: ${String(p.source_rail).toUpperCase()}\n` : ""}${serviceChargeAmount > 0 ? `${isMoneyInConversion ? "Transaction fee" : "Service charge"}: -${isMoneyInConversion ? fmtReceiptMoney(serviceChargeAmount, sourceCurrency) : fmtMoney(serviceChargeAmount, sourceCurrency)}\nBorderPay\n` : ""}${isMoneyInConversion ? "" : `Available for conversion: ${fmtMoney(availableAmount, sourceCurrency)}\n`}${Number.isFinite(Number(p.exchange_rate)) && Number(p.exchange_rate) > 0 ? `Exchange rate: 1 ${sourceCurrency} = ${p.exchange_rate} ${destinationCurrency}\n` : ""}${isMoneyInConversion ? "Converted amount / added to wallet" : "Outgoing funds"}: ${isMoneyInConversion ? walletAmount : outgoing}\n${p.destination_address ? `Destination: ${p.destination_address}\n` : ""}Status: ${isMoneyInConversion ? "Approved / Completed" : displayHeading}\nReference: ${p.reference}\nWhen: ${occurredAt}`
        : `${company}\n${c.intro}\n${hasFeeBreakdown ? `Full amount received: ${gross}\n${transactionFeeAmount > 0 ? `Transaction fee: -${transactionFee}\n` : ""}${exchangeFeeAmount > 0 ? `Exchange fee: -${exchangeFee}\n` : ""}Net amount: ${amount}` : `Amount: ${amount}`}\nStatus: ${c.heading}\nReference: ${p.reference}\n${p.description ? "Description: " + p.description + "\n" : ""}When: ${occurredAt}`,
      ctaText: "Open BorderPay",
      ctaUrl,
    }),
  };
}
