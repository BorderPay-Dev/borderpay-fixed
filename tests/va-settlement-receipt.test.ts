import { render as renderBusiness } from '../supabase/functions/_shared/email-templates/business/transaction-status.ts';
import { render as renderIndividual } from '../supabase/functions/_shared/email-templates/individual/transaction-status.ts';

Deno.env.set('SUPABASE_URL', 'https://va-receipt-db.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
Deno.env.set('SEND_EMAIL_INTERNAL_TOKEN', 'test-only');
const serve = Deno.serve;
Deno.serve = (() => ({})) as unknown as typeof Deno.serve;
const { receivedAmountBreakdown, bridgeVaReceiptDetails, transactionStatusBody, handleBridgeVirtualAccount } = await import('../supabase/functions/process-pending-events/index.ts');
Deno.serve = serve;
function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}
const settlement = {
  type: 'payment_processed', amount: '9888.05', currency: 'usdc',
  developer_fee_amount: '264.51', exchange_fee_amount: '0',
  deposit_id: 'deposit-fixture', destination_payment_rail: 'base',
  receipt: { initial_amount: '8876.00', developer_fee: '264.51', exchange_fee: '0',
    subtotal_amount: '8611.49', final_amount: '9888.05', exchange_rate: '1.148239' },
};
function details(payload: any, currency = 'EUR', destination = 'usdc') {
  return bridgeVaReceiptDetails({ payload, sourceCurrency: currency, vaId: 'va-fixture',
    accountDetails: { destination: { currency: destination, payment_rail: 'base' } },
    breakdown: receivedAmountBreakdown(payload, currency) });
}
Deno.test('EUR deposit keeps fiat gross and fee separate from the USDC settlement', () => {
  const receipt = details(settlement);
  equal(receipt.source_amount, 8876);
  equal(receipt.service_charge_amount, 264.51);
  equal(receipt.available_amount, 8611.49);
  equal(receipt.destination_amount, 9888.05);
  equal(receipt.source_currency, 'EUR');
  equal(receipt.destination_currency, 'USDC');
  equal(receipt.exchange_rate, 1.148239);
  for (const render of [renderBusiness, renderIndividual]) {
    const email = render({ status: 'approved', amount: 8611.49, currency: 'EUR', reference: 'deposit-fixture',
      gross_amount: 8876, developer_fee_amount: 264.51, net_amount: 8611.49, ...receipt });
    for (const content of [email.html, email.text]) {
      for (const expected of ['8,876.00 EUR', '264.51 EUR', '8,611.49 EUR', '9,888.05 USDC']) {
        if (!content.includes(expected)) throw new Error(`Receipt missing ${expected}`);
      }
      if (content.includes('Expected same day') || content.includes('9,888.05 EUR') || content.includes('9,623.54')) throw new Error('Mixed-currency deduction returned');
    }
  }
  const body = transactionStatusBody('approved', '8,611.49 EUR', { receipt });
  if (!body.includes('9,888.05 USDC') || !body.includes('8,876 EUR')) throw new Error(body);
});
Deno.test('same-currency settlement does not subtract fees from the outgoing amount twice', () => {
  const receipt = details({ ...settlement, currency: 'usd', amount: '98',
    receipt: { initial_amount: '100', developer_fee: '2', exchange_fee: '0', subtotal_amount: '98', final_amount: '98' } }, 'USD');
  equal(receipt.source_amount, 100); equal(receipt.available_amount, 98); equal(receipt.destination_amount, 98);
});
Deno.test('incoming fiat credit still uses incoming event amount and deducts source fees once', () => {
  const b = receivedAmountBreakdown({ type: 'funds_received', amount: '8876', currency: 'eur', developer_fee_amount: '264.51' }, 'EUR');
  equal(b?.grossMinor, 887600n); equal(b?.netMinor, 861149n);
});
Deno.test('EURC settlement is kept distinct from EUR and authoritative zero fees are preserved', () => {
  const receipt = details({ ...settlement, currency: 'eurc', amount: '100', developer_fee_amount: '2',
    receipt: { initial_amount: '100', developer_fee: '0', exchange_fee: '0', subtotal_amount: '100', final_amount: '100' } }, 'EUR', 'eurc');
  equal(receipt.source_amount, 100); equal(receipt.service_charge_amount, 0);
  equal(receipt.destination_currency, 'EURC'); equal(receipt.destination_amount, 100);
});
Deno.test('missing source receipt never invents incoming fiat from an outgoing event', () => {
  const { receipt: _, ...withoutReceipt } = settlement;
  const receipt = details(withoutReceipt);
  equal(receivedAmountBreakdown(withoutReceipt, 'EUR'), null);
  equal(receipt.source_amount, null); equal(receipt.available_amount, null);
  equal(receipt.destination_amount, 9888.05);
});
Deno.test('source subtotal excludes exchange fees and destination gas is never deducted from fiat', () => {
  const receipt = details({ ...settlement, amount: '110',
    receipt: { initial_amount: '100', developer_fee: '2', exchange_fee: '1', subtotal_amount: '97', gas_fee: '0.5', final_amount: '110' } });
  equal(receipt.source_amount, 100); equal(receipt.available_amount, 97); equal(receipt.destination_amount, 110);
});
Deno.test('outgoing event amount supplies destination only when final receipt amount is absent', () => {
  const { final_amount: _, ...receipt } = settlement.receipt;
  equal(details({ ...settlement, receipt }).destination_amount, 9888.05);
});

Deno.test('actual VA settlement handler sends the correct receipt without a second ledger credit', async () => {
  const originalFetch = globalThis.fetch;
  const emails: any[] = [];
  const mutations: Array<{ path: string; body: any }> = [];
  const accountDetails = { destination: { currency: 'usdc', payment_rail: 'base', bridge_wallet_id: 'wallet-fixture' }, source_deposit_instructions: { currency: 'eur', payment_rail: 'sepa' } };
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== 'https://va-receipt-db.invalid') throw new Error('Unexpected external request');
    if (req.method !== 'GET') {
      const body = await req.json();
      mutations.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/send-email')) { emails.push(body); return Response.json({ success: true }); }
      if (url.pathname.includes('/rpc/')) return Response.json(null);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.includes('/auth/v1/admin/users/')) return Response.json({ id: '00000000-0000-4000-8000-000000000001', email_confirmed_at: '2026-01-01' });
    if (url.pathname.endsWith('/bridge_virtual_accounts')) return Response.json([{ bridge_customer_id: 'customer-fixture', currency: 'EUR', developer_fee_percent: 3, account_details: accountDetails }]);
    if (url.pathname.endsWith('/business_profiles')) return Response.json([{ user_id: '00000000-0000-4000-8000-000000000001', company_name: 'Receipt Fixture Ltd' }]);
    if (url.pathname.endsWith('/user_profiles')) return Response.json([{ id: '00000000-0000-4000-8000-000000000001', account_type: 'business', email: 'receipt@example.invalid', is_admin: false }]);
    if (url.pathname.endsWith('/notifications')) return Response.json([]);
    throw new Error(`Unexpected read: ${url.pathname}`);
  };
  try {
    // Some Bridge events label the amount with the pegged fiat currency;
    // both representations must use the VA destination's actual asset.
    for (const eventCurrency of ['usdc', 'eur']) {
      mutations.length = 0; emails.length = 0;
      await handleBridgeVirtualAccount({ event_id: 'event-fixture', event_type: 'virtual_account.activity.updated',
        source: 'bridge', payload: { event_object: { ...settlement, currency: eventCurrency,
          id: 'activity-fixture', virtual_account_id: 'va-fixture', customer_id: 'customer-fixture' } } } as any);
      equal(emails.length, 1);
      equal(emails[0].props.source_amount, 8876);
      equal(emails[0].props.available_amount, 8611.49);
      equal(emails[0].props.destination_amount, 9888.05);
      equal(emails[0].props.destination_currency, 'USDC');
      equal(emails[0].props.developer_fee_amount, 264.51);
      if (mutations.some(m => /apply_bridge|wallet_balance|balance_ledger/.test(m.path))) throw new Error('Settlement must not mutate balances');
      const notification = mutations.find(m => m.path.endsWith('/notifications'))?.body;
      equal(notification?.metadata.balance_impact, 'none');
      if (!notification?.body.includes('9,888.05 USDC')) throw new Error('Notification lost destination amount');
      const completed = mutations.find(m => m.path.endsWith('/complete_pending_event'))?.body;
      equal(completed?.p_summary.credited, false);
    }
    mutations.length = 0; emails.length = 0;
    const { receipt: _, ...incompleteSettlement } = settlement;
    await handleBridgeVirtualAccount({ event_id: 'event-no-receipt', event_type: 'virtual_account.activity.updated',
      source: 'bridge', payload: { event_object: { ...incompleteSettlement,
        virtual_account_id: 'va-fixture', customer_id: 'customer-fixture' } } } as any);
    equal(emails.length, 0);
    if (mutations.some(m => /apply_bridge|wallet_balance|balance_ledger/.test(m.path))) throw new Error('Incomplete receipt must not mutate balances');
    equal(mutations.find(m => m.path.endsWith('/complete_pending_event'))?.body.p_summary.receipt_status, 'source_amount_unavailable');
  } finally { globalThis.fetch = originalFetch; }
});
