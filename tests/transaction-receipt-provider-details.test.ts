import {
  normalizeTransactionReceipt,
  providerReceiptTextRows,
} from '../utils/transactions/receipt.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

Deno.test('normalizes customer-visible Bridge bank and tracking fields', () => {
  const receipt = normalizeTransactionReceipt({
    amount: 500,
    metadata: {
      bridge_transfer_id: 'bridge-transfer-1',
      receipt: {
        source_currency: 'EUR',
        source_amount: 500,
        destination_currency: 'USDC',
        destination_amount: 561.1,
        source_bank: { name: 'Sender Bank', routing_number: '110000000', address: '1 Sender Road' },
        source: { account_number: 'DE001234', sender_name: 'JEANNE LUCAS' },
        receiving_bank: { name: 'Banking Circle', routing_number: 'BC123', address: 'Luxembourg' },
        receiving_account_name: 'VELVET HORIZON LTD',
        receiving_account_number: 'LU001234',
        payment_reference: 'INV-1042',
        payment_tracking: {
          trace_id: 'trace-1',
          imad: 'imad-1',
          uetr: 'uetr-1',
          clave_de_rastreo: 'clave-1',
        },
      },
    },
  });
  if (!receipt) throw new Error('expected receipt');
  assertEquals(receipt.bridgeTransactionId, 'bridge-transfer-1', 'Bridge transaction ID');
  assertEquals(receipt.sourceBankName, 'Sender Bank', 'source bank');
  assertEquals(receipt.sourceBankRoutingNumber, '110000000', 'source routing');
  assertEquals(receipt.receivingBankName, 'Banking Circle', 'receiving bank');
  assertEquals(receipt.receivingAccountNumber, 'LU001234', 'receiving account');
  assertEquals(receipt.traceId, 'trace-1', 'trace ID');
  assertEquals(receipt.imad, 'imad-1', 'IMAD');
  assertEquals(receipt.uetr, 'uetr-1', 'UETR');
  assertEquals(receipt.claveDeRastreo, 'clave-1', 'clave');
});

Deno.test('keeps a refund-only receipt even when no fee or conversion amount exists', () => {
  const receipt = normalizeTransactionReceipt({
    amount: 500,
    metadata: {
      refund_details: {
        return_reason: 'Risk Rejection',
        returned_at: '2026-09-10T10:05:24Z',
        risk_rejection_reason: 'Receiver Name Mismatch',
        customer_name: 'VELVET HORIZON LTD',
        deposit_originator_name: 'JEANNE LUCAS',
        deposit_beneficiary_name: 'LUCAS JEANNE',
        refund_rail: 'SEPA',
        refund_beneficiary_name: 'JEANNE LUCAS',
        refund_reference_id: '010F271262533MR1',
      },
    },
  });
  if (!receipt) throw new Error('refund evidence must produce a receipt');
  assertEquals(receipt.refundReturnReason, 'Risk Rejection', 'return reason');
  const rows = providerReceiptTextRows(receipt);
  for (const expected of ['Return reason', 'Risk rejection reason', 'Refund reference ID']) {
    if (!rows.some((row) => row.label === expected)) throw new Error(`missing row: ${expected}`);
  }
});

Deno.test('does not expose arbitrary raw webhook keys as receipt rows', () => {
  const receipt = normalizeTransactionReceipt({
    amount: 1,
    metadata: {
      bridge_transfer_id: 'bridge-transfer-2',
      raw: { signature: 'secret', api_key: 'secret', internal_risk_metadata: 'secret' },
    },
  });
  if (!receipt) throw new Error('expected provider receipt');
  const values = providerReceiptTextRows(receipt).map((row) => row.value);
  if (values.includes('secret')) throw new Error('internal webhook fields leaked');
});
