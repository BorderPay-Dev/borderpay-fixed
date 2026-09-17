import { escapeHtml, htmlLayout, textLayout, type RenderedEmail } from '../layout.ts';

function isoDate(value: unknown): string {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new Error('Valid billing date required');
  return s;
}
function dateLabel(value: unknown): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(isoDate(value)));
}
function amountLabel(p: Record<string, unknown>): string {
  const amount = Number(p.amount), currency = String(p.currency || 'USD').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) throw new Error('Valid invoice amount and currency required');
  return `${amount.toFixed(2)} ${currency}`;
}
function message(heading: string, body: string, ctaText?: string, ctaUrl?: string): RenderedEmail {
  return { subject: `BorderPay — ${heading}`, html: htmlLayout({ heading, body: body.split('\n\n').map(p => `<p style="line-height:1.6;overflow-wrap:anywhere">${escapeHtml(p).replaceAll('\n', '<br />')}</p>`).join(''), ctaText, ctaUrl }), text: textLayout({ heading, body, ctaText, ctaUrl }) };
}
export function renderExternalInvoice(p: Record<string, unknown>): RenderedEmail {
  const amount = amountLabel(p), billingDate = isoDate(p.billing_period);
  const reference = String(p.transaction_reference || '').trim();
  const url = new URL(String(p.payment_link || ''));
  if (!reference || url.protocol !== 'https:' || url.hostname !== 'checkout.flutterwave.com' || url.username || url.password || !url.pathname.startsWith('/v3/hosted/pay/')) throw new Error('Verified invoice payment link and reference required');
  const notice = String(p.notice || 'invoice');
  if (!['invoice', 'reminder', 'final_warning'].includes(notice)) throw new Error('Unknown invoice notice');
  const reminder = notice !== 'invoice';
  let deadline = '';
  if (reminder) {
    const due = isoDate(p.deadline);
    if (due < billingDate || billingDate > new Date().toISOString().slice(0, 10)) throw new Error('Reminder dates are inconsistent with invoice');
    deadline = `\nPayment deadline: ${dateLabel(due)}`;
  }
  const heading = reminder ? 'Maintenance payment reminder' : 'Your maintenance invoice is ready';
  const body = `Hello ${String(p.customer_name || 'there')},\n\n${reminder ? 'Our records show that this maintenance invoice is still unpaid.' : 'Your account maintenance invoice is available. You may pay it before its billing date.'}\n\nAmount: ${amount}\nBilling date: ${dateLabel(billingDate)}${deadline}\nReference: ${reference}\nPayment link: ${url.href}\n\nPay externally using the secure checkout below. This fee is not deducted from your BorderPay account balance.\n\nPayment is recorded against this invoice after confirmation from the payment provider. If you have already paid, please contact Support before paying again.`;
  return message(heading, body, 'Pay maintenance invoice', url.href);
}
export function renderPaymentStatus(p: Record<string, unknown>): RenderedEmail {
  const amount = amountLabel(p), outcome = String(p.outcome || '');
  if (!['completed', 'failed', 'pending'].includes(outcome) || !p.transaction_reference) throw new Error('Verified payment outcome and reference required');
  const heading = outcome === 'completed' ? 'Maintenance payment confirmed' : 'Maintenance payment update';
  const body = `Hello ${String(p.customer_name || 'there')},\n\n${outcome === 'completed' ? 'Your account maintenance payment has been confirmed.' : 'Your maintenance payment has not been confirmed. Please contact Support if you have already paid.'}\n\nAmount: ${amount}\nDate: ${dateLabel(p.date)}\nReference: ${String(p.transaction_reference)}\n\nThank you,\nBorderPay Support`;
  return message(heading, body);
}
