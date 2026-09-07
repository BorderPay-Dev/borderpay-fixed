import { escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string;
  notice?: "invoice" | "reminder" | "final_warning";
  amount: number;
  currency?: string;
  billing_period?: string;
  payment_link: string;
  transaction_reference?: string;
  deadline?: string;
}

export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const currency = String(p.currency || "USD").toUpperCase();
  const amount = Number(p.amount).toFixed(2);
  const notice = p.notice || "invoice";
  const deadline = p.deadline || "September 8, 2026";
  const isReminder = notice === "reminder";
  const isFinal = notice === "final_warning";
  const heading = isFinal
    ? "Final notice: Individual account closure"
    : isReminder
      ? "Action required: Individual maintenance payment"
      : "Individual account maintenance invoice";
  const introduction = isFinal
    ? "This is the third and final notice for your unpaid Individual account maintenance invoice. If payment has not been confirmed, your Individual product access will be permanently closed, your virtual accounts will be deactivated, and you will not be eligible to regain BorderPay Individual access."
    : isReminder
      ? `Your Individual account maintenance invoice remains unpaid. Payment must be confirmed by ${deadline}. If it is not confirmed by the deadline, your Individual product access will be permanently closed, your virtual accounts will be deactivated, and you will not be eligible to regain BorderPay Individual access.`
      : "Your BorderPay Individual account maintenance invoice is ready. Payment is recorded only after the payment provider confirms the transaction.";
  const balanceNotice = isReminder || isFinal
    ? "Account closure does not forfeit any remaining customer funds or statutory rights. Contact support@borderpayafrica.com for balance-return assistance."
    : "";
  const body = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(introduction)}</p>
    <p><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}<br />
    <strong>Billing period:</strong> ${escapeHtml(p.billing_period || "—")}<br />
    <strong>Reference:</strong> ${escapeHtml(p.transaction_reference || "—")}</p>
    <p>Use the secure payment link below. Do not pay the same invoice twice.</p>
    ${balanceNotice ? `<p>${escapeHtml(balanceNotice)}</p>` : ""}`;

  return {
    subject: isFinal
      ? "Final notice: your BorderPay Individual account is being closed"
      : isReminder
        ? `Payment required by ${deadline}: BorderPay Individual account`
        : `BorderPay Individual maintenance invoice — ${currency} ${amount}`,
    html: htmlLayout({
      heading,
      body,
      ctaText: "Pay invoice",
      ctaUrl: p.payment_link,
      brandTone: isFinal ? "danger" : "warning",
    }),
    text: textLayout({
      heading,
      body: `Hi ${name},\n\n${introduction}\n\nAmount: ${currency} ${amount}\nBilling period: ${p.billing_period || "—"}\nReference: ${p.transaction_reference || "—"}\n\nPay securely: ${p.payment_link}\n\nPayment is recorded only after provider confirmation. Do not pay twice.${balanceNotice ? `\n\n${balanceNotice}` : ""}`,
    }),
  };
}
