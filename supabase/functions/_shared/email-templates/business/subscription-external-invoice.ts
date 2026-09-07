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
  const deadline = p.deadline || "the stated deadline";
  const isReminder = notice === "reminder";
  const isFinal = notice === "final_warning";
  const heading = isFinal
    ? "Final Business maintenance payment warning"
    : isReminder
      ? "Business maintenance payment reminder"
      : "Business account maintenance invoice";
  const introduction = isFinal
    ? "This is the final notice for your unpaid Business account maintenance invoice. Receiving accounts, wallets, and sensitive financial screens will be temporarily restricted after this notice. Access is restored only after the payment provider confirms payment."
    : isReminder
      ? `Your Business account maintenance invoice remains unpaid. Please pay by ${deadline} to avoid a temporary restriction of receiving accounts, wallets, and sensitive financial screens.`
      : "Your BorderPay Business account maintenance invoice is ready. Payment is recorded only after the payment provider confirms the transaction.";
  const body = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(introduction)}</p>
    <p><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}<br />
    <strong>Billing period:</strong> ${escapeHtml(p.billing_period || "—")}<br />
    <strong>Reference:</strong> ${escapeHtml(p.transaction_reference || "—")}</p>
    <p>Use the secure payment link below. Do not pay the same invoice twice.</p>`;

  return {
    subject: isFinal
      ? `Final Business maintenance notice — ${currency} ${amount}`
      : isReminder
        ? `Business maintenance payment reminder — ${currency} ${amount}`
        : `BorderPay Business maintenance invoice — ${currency} ${amount}`,
    html: htmlLayout({ heading, body, ctaText: "Pay invoice", ctaUrl: p.payment_link, brandTone: isFinal ? "danger" : "warning" }),
    text: textLayout({
      heading,
      body: `Hi ${name},\n\n${introduction}\n\nAmount: ${currency} ${amount}\nBilling period: ${p.billing_period || "—"}\nReference: ${p.transaction_reference || "—"}\n\nPay securely: ${p.payment_link}\n\nPayment is recorded only after provider confirmation. Do not pay twice.`,
    }),
  };
}
