import { escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string;
  notice?: "invoice" | "reminder" | "final_warning";
  amount: number;
  currency?: string;
  billing_period?: string;
  payment_link: string;
  transaction_reference?: string;
}

export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const currency = String(p.currency || "USD").toUpperCase();
  const amount = Number(p.amount).toFixed(2);
  const notice = p.notice || "invoice";
  const finalWarning = notice === "final_warning";
  const reminder = notice === "reminder";
  const heading = finalWarning
    ? "Final maintenance payment warning"
    : reminder
      ? "Account maintenance payment reminder"
      : "Account maintenance invoice";
  const introduction = finalWarning
    ? "This is the third and final notice for your unpaid BorderPay account maintenance invoice. Your virtual accounts and sensitive financial screens will be restricted after this notice is delivered. Access is restored only after the payment provider confirms payment."
    : reminder
      ? "Your BorderPay account maintenance invoice is still unpaid. Please pay it before the final notice to keep your virtual accounts, wallets, and sensitive financial screens available."
      : "Your BorderPay account maintenance invoice is ready. Payment is recorded only after the payment provider confirms the transaction.";
  const body = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(introduction)}</p>
    <p><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}<br />
    <strong>Billing period:</strong> ${escapeHtml(p.billing_period || "—")}<br />
    <strong>Reference:</strong> ${escapeHtml(p.transaction_reference || "—")}</p>
    <p>Use the secure payment link below. Do not pay the same invoice twice.</p>`;

  return {
    subject: finalWarning
      ? `Final notice: BorderPay maintenance payment — ${currency} ${amount}`
      : reminder
        ? `Reminder: BorderPay maintenance payment — ${currency} ${amount}`
        : `BorderPay maintenance invoice — ${currency} ${amount}`,
    html: htmlLayout({ heading, body, ctaText: "Pay invoice", ctaUrl: p.payment_link, brandTone: "warning" }),
    text: textLayout({
      heading,
      body: `Hi ${name},\n\n${introduction}\nAmount: ${currency} ${amount}\nBilling period: ${p.billing_period || "—"}\nReference: ${p.transaction_reference || "—"}\n\nPay securely: ${p.payment_link}\n\nPayment is recorded only after provider confirmation. Do not pay twice.`,
    }),
  };
}
