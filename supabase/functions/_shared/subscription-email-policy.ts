export function prepareInvoiceEmail(job: any, invoice: any, subscription: any, now = new Date()) {
  const suppress = (reason: string) => ({ action: 'suppress' as const, reason });
  if (!invoice || invoice.user_id !== job.user_id || invoice.provider_reference !== job.props?.transaction_reference) return suppress('invoice_not_found_for_owner');
  if (invoice.status !== 'payment_link_created' || invoice.paid_at || !invoice.payment_link) return suppress('invoice_not_payable');
  if (!subscription || subscription.user_id !== job.user_id || subscription.status !== 'active') return suppress('subscription_not_active');
  const due = Date.parse(`${invoice.billing_period}T00:00:00Z`);
  if (!Number.isFinite(due)) return suppress('invalid_invoice_date');
  const notice = String(job.props?.notice || 'invoice');
  if (!['invoice', 'reminder', 'final_warning'].includes(notice)) return suppress('unsupported_notice');
  const rawGrace = subscription.grace_started_at ? Date.parse(subscription.grace_started_at) : due;
  if (!Number.isFinite(rawGrace)) return suppress('invalid_grace_date');
  const grace = Math.max(rawGrace, due);
  const deadline = new Date(grace + 7 * 86400000).toISOString().slice(0, 10);
  if (notice !== 'invoice') {
    const eligibleAt = grace + (notice === 'reminder' ? 3 : 7) * 86400000;
    if (now.getTime() < eligibleAt) return { action: 'defer' as const, nextAttemptAt: new Date(eligibleAt).toISOString() };
  }
  return { action: 'send' as const, props: { ...job.props, amount: Number(invoice.amount), currency: invoice.currency,
    billing_period: invoice.billing_period, payment_link: invoice.payment_link, transaction_reference: invoice.provider_reference,
    ...(notice !== 'invoice' ? { deadline } : {}) } };
}

export function confirmedEmailDelivery(responseOk: boolean, payload: any): boolean {
  return responseOk && payload?.success === true && payload?.data?.status === 'sent';
}
