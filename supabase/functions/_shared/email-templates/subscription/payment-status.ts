import { BORDERPAY_BRAND, escapeHtml, firstName, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface Props {
  customer_name?: string; outcome: "completed" | "failed" | "reminder";
  amount: number; asset?: string; date?: string; transaction_reference?: string;
}
export function render(p: Props): RenderedEmail {
  const name = firstName(p.customer_name);
  const success = p.outcome === "completed";
  const reminder = p.outcome === "reminder";
  const heading = success ? "Subscription Payment Successful" : reminder ? "Subscription Payment Reminder" : "Subscription Payment Failed";
  const message = success
    ? `Your BorderPay account maintenance fee of $${Number(p.amount).toFixed(2)} has been successfully deducted.`
    : reminder
      ? `Your $${Number(p.amount).toFixed(2)} account maintenance payment is still pending. Please deposit USDC or USDT to keep all account features available.`
      : "Your BorderPay subscription payment could not be completed because your wallet balance is insufficient. Please deposit funds to continue using your account services.";
  const details = success ? `<p><strong>Amount:</strong> $${Number(p.amount).toFixed(2)}<br /><strong>Asset used:</strong> ${escapeHtml(p.asset || "USDC/USDT")}<br /><strong>Date:</strong> ${escapeHtml(p.date || "—")}<br /><strong>Transaction reference:</strong> ${escapeHtml(p.transaction_reference || "—")}</p>` : "";
  const body = `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p>${details}`;
  return { subject: heading, html: htmlLayout({ heading, body, ctaText: success ? "View account" : "Fund wallet", ctaUrl: BORDERPAY_BRAND.appUrl, brandTone: success ? "default" : "warning" }), text: textLayout({ heading, body }) };
}
