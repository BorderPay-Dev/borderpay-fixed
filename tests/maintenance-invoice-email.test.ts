import { renderTemplate } from '../supabase/functions/_shared/email-templates/index.ts';
import { prepareInvoiceEmail, confirmedEmailDelivery } from '../supabase/functions/_shared/subscription-email-policy.ts';
const props = { customer_name: '<Customer>', amount: 29.99, currency: 'USD', billing_period: '2026-09-30', payment_link: 'https://checkout.flutterwave.com/v3/hosted/pay/example', transaction_reference: 'bp-maintenance-test' };
function assert(value: unknown) { if (!value) throw new Error('Assertion failed'); }
function rejects(f: () => unknown) { let failed = false; try { f(); } catch { failed = true; } assert(failed); }
Deno.test('business and individual invoices include actual amount, due date, external link and reference', () => {
  for (const template of ['business.subscription_external_invoice', 'individual.subscription_external_invoice'] as const) {
    const rendered = renderTemplate(template, props);
    assert(rendered.text.includes('29.99 USD') && rendered.text.includes('30 September 2026'));
    assert(rendered.text.includes(props.payment_link) && rendered.text.includes(props.transaction_reference));
    assert(rendered.text.includes('not deducted') && !rendered.text.includes('September 8'));
    assert(rendered.html.includes('&lt;Customer&gt;') && !rendered.html.includes('<Customer>'));
  }
});
Deno.test('invoice renderer rejects unsafe checkout links and impossible dates', () => {
  for (const payment_link of ['javascript:alert(1)', 'https://checkout.flutterwave.com.evil.test/v3/hosted/pay/x', 'http://checkout.flutterwave.com/v3/hosted/pay/x', 'https://user:pass@checkout.flutterwave.com/v3/hosted/pay/x']) rejects(() => renderTemplate('business.subscription_external_invoice', {...props,payment_link}));
  rejects(() => renderTemplate('business.subscription_external_invoice', {...props,billing_period:'2026-02-31'}));
  rejects(() => renderTemplate('business.subscription_external_invoice', {...props,notice:'reminder',billing_period:'2099-01-31',deadline:'2099-02-07'}));
});
Deno.test('receipt templates show historical paid amount without replacing it with current price', () => {
  for (const template of ['business.subscription_payment_status', 'individual.subscription_payment_status'] as const) {
    const r = renderTemplate(template,{amount:15,date:'2026-09-08',outcome:'completed',transaction_reference:'paid-reference'});
    assert(r.text.includes('15.00 USD') && r.text.includes('confirmed') && !r.text.includes('29.99'));
  }
});
const invoice = { ...props, user_id:'owner', subscription_id:'sub', status:'payment_link_created', paid_at:null, provider_reference:props.transaction_reference };
const subscription = { user_id:'owner',status:'active',grace_started_at:'2026-09-13T13:00:00Z' };
const job = { user_id:'owner',props:{...props,notice:'reminder',deadline:'September 8, 2026',amount:999} };
Deno.test('future invoice reminder is deferred to due date plus three days despite old grace', () => {
  const p = prepareInvoiceEmail(job,invoice,subscription,new Date('2026-09-17T00:00:00Z'));
  assert(p.action==='defer' && p.nextAttemptAt==='2026-10-03T00:00:00.000Z');
});
Deno.test('due reminder uses authoritative amount and deadline, and final warning waits seven days', () => {
  const p=prepareInvoiceEmail(job,invoice,subscription,new Date('2026-10-03T00:00:00Z'));
  assert(p.action==='send' && p.props.deadline==='2026-10-07' && p.props.amount===29.99);
  const final=prepareInvoiceEmail({...job,props:{...job.props,notice:'final_warning'}},invoice,subscription,new Date('2026-10-03T00:00:00Z'));
  assert(final.action==='defer' && final.nextAttemptAt==='2026-10-07T00:00:00.000Z');
});
Deno.test('paid, cancelled, mismatched owner and inactive subscriptions suppress stale invoice emails', () => {
  for(const i of [{...invoice,status:'paid'}, {...invoice,status:'cancelled'}, {...invoice,paid_at:'2026-09-17'}, {...invoice,user_id:'someone-else'}]) assert(prepareInvoiceEmail(job,i,subscription).action==='suppress');
  assert(prepareInvoiceEmail(job,invoice,{...subscription,status:'cancelled'}).action==='suppress');
});
Deno.test('HTTP success without explicit sent result is not delivery confirmation', () => {
  for (const status of ['queued','sending','failed',undefined]) assert(!confirmedEmailDelivery(true,{success:true,data:{status}}));
  assert(!confirmedEmailDelivery(false,{success:true,data:{status:'sent'}}));
  assert(confirmedEmailDelivery(true,{success:true,data:{status:'sent'}}));
});
