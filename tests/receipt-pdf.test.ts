import { buildReceiptPdf } from '../utils/receipts/buildReceiptPdf.ts';

Deno.test('money-out receipt uses restrained amount typography and a single clean page', async () => {
  const receipt = buildReceiptPdf([
    { label: 'Money out receipt', value: '$200.00 USD', large: true },
    { label: 'Status', value: 'Transaction sent' },
    { label: 'Recipient', value: 'Valentine Adhiambo' },
    { label: 'Transaction fee', value: 'KSh252.00 KES' },
    { label: 'Reference', value: '2603f2c2-217e-46ff-b82a-4387924ff5ae' },
  ]);
  const text = new TextDecoder().decode(await receipt.arrayBuffer());
  if (!text.includes('/F2 18 Tf')) throw new Error('amount must use the restrained 18pt receipt style');
  if (text.includes('/F1 24 Tf') || text.includes('/F2 24 Tf')) throw new Error('oversized 24pt amount style returned');
  if (!text.includes('/Count 1')) throw new Error('receipt must remain a single page');
});
