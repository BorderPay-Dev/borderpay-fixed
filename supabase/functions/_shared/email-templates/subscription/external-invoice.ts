import { escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string;
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
  const heading = "Account maintenance invoice";
  const body = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your BorderPay account maintenance invoice is ready. Payment is recorded only after the payment provider confirms the transaction.</p>
    <p><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}<br />
    <strong>Billing period:</strong> ${escapeHtml(p.billing_period || "—")}<br />
    <strong>Reference:</strong> ${escapeHtml(p.transaction_reference || "—")}</p>
    <p>Use the secure payment link below. Do not pay the same invoice twice.</p>`;

  return {
    subject: `BorderPay maintenance invoice — ${currency} ${amount}`,
    html: htmlLayout({
      heading,
      body,
      ctaText: "Pay invoice",
      ctaUrl: p.payment_link,
      brandTone: "warning",
    }),
    text: textLayout({
      heading,
      body: `Hi ${name},\n\nYour BorderPay account maintenance invoice is ready.\nAmount: ${currency} ${amount}\nBilling period: ${p.billing_period || "—"}\nReference: ${p.transaction_reference || "—"}\n\nPay securely: ${p.payment_link}\n\nPayment is recorded only after provider confirmation. Do not pay twice.`,
    }),
  };
}
