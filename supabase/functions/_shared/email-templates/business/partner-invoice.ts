import { BORDERPAY_BRAND, escapeHtml, htmlLayout, textLayout, type RenderedEmail } from "../layout.ts";

export interface PartnerInvoiceProps {
  partner_name: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  due_at: string;
  total: string;
  currency?: string;
  payment_method: string;
  payment_url?: string | null;
}

export function render(p: PartnerInvoiceProps): RenderedEmail {
  const partner = String(p.partner_name || "Partner");
  const currency = String(p.currency || "USD");
  const total = `${currency} ${String(p.total || "0.00")}`;
  const paymentUrl = String(p.payment_url || "https://portal.borderpayafrica.com");
  const body = `
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">Hello ${escapeHtml(partner)},</p>
    <p style="margin:0 0 16px;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">Your BorderPay partner invoice is available in the Billing workspace.</p>
    <div style="margin:0 0 16px;padding:16px;border:1px solid ${BORDERPAY_BRAND.border};background:#FFFFFF;">
      <strong style="color:${BORDERPAY_BRAND.text};">Invoice ${escapeHtml(p.invoice_number)}</strong><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">Period: ${escapeHtml(p.period_start)} to ${escapeHtml(p.period_end)}</span><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">Amount due: ${escapeHtml(total)}</span><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">Due: ${escapeHtml(p.due_at)}</span><br />
      <span style="color:${BORDERPAY_BRAND.textMuted};">Payment method: ${escapeHtml(p.payment_method)}</span>
    </div>
    <p style="margin:0;color:${BORDERPAY_BRAND.text};font-size:14px;line-height:1.65;">The Billing workspace contains the itemized charges, allocation basis, payment instructions, and payment status.</p>`;
  return {
    subject: `BorderPay partner invoice ${p.invoice_number}`,
    html: htmlLayout({ preview: `Invoice ${p.invoice_number} — ${total}`, heading: "Partner invoice", introText: "An itemized invoice is ready for review.", body, ctaText: "Review invoice", ctaUrl: paymentUrl }),
    text: textLayout({ heading: "BorderPay partner invoice", body: `Hello ${partner},\n\nInvoice ${p.invoice_number}\nPeriod: ${p.period_start} to ${p.period_end}\nAmount due: ${total}\nDue: ${p.due_at}\nPayment method: ${p.payment_method}\n\nReview the itemized charges, allocation basis, and payment status in the Billing workspace.`, ctaText: "Review invoice", ctaUrl: paymentUrl }),
  };
}
