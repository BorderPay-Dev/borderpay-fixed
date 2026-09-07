import { render } from "../../supabase/functions/_shared/email-templates/business/transaction-status.ts";

function mustInclude(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected rendered receipt to include: ${expected}`);
  }
}

function mustExclude(value: string, forbidden: string): void {
  if (value.includes(forbidden)) {
    throw new Error(`Rendered receipt must not include: ${forbidden}`);
  }
}

Deno.test("converted EUR VA receipt keeps source and destination amounts in their currencies", () => {
  const receipt = render({
    company_name: "OMANIOR LTD",
    status: "approved",
    amount: 485.10,
    currency: "EUR",
    reference: "23607526-40c4-4bde-a255-f26d29b8a482",
    description: "Deposit processed",
    gross_amount: 500,
    developer_fee_amount: 14.90,
    net_amount: 485.10,
    source_currency: "EUR",
    source_amount: 500,
    service_charge_amount: 14.90,
    available_amount: 485.10,
    destination_currency: "USDC",
    destination_amount: 561.10,
    exchange_rate: 1.156668,
    destination_address: "0x81...245c",
    deposit_id: "cb80462f-a99e-46a5-a20c-1f12f3a97005",
    sender_name: "Example Sender Ltd",
    source_bank_name: "Example Originating Bank",
    source_bank_account: "DE02120300000000202051",
    receiving_account_holder: "OMANIOR LTD",
    receiving_bank_name: "Banking Circle S.A.",
    receiving_iban: "LU120010001234567891",
    payment_reference: "Invoice 2026-0907",
    bridge_transaction_id: "bridge-payment-123",
    uetr: "550e8400-e29b-41d4-a716-446655440000",
  });

  mustInclude(receipt.text, "Incoming funds: 500.00 EUR");
  mustInclude(receipt.text, "Service charge: 14.90 EUR");
  mustInclude(receipt.text, "Available for conversion: 485.10 EUR");
  mustInclude(receipt.text, "Outgoing funds: 561.10 USDC");
  mustInclude(receipt.text, "Sender: Example Sender Ltd");
  mustInclude(receipt.text, "Source bank: Example Originating Bank");
  mustInclude(receipt.text, "Receiving account holder: OMANIOR LTD");
  mustInclude(receipt.text, "Payment reference: Invoice 2026-0907");
  mustInclude(receipt.text, "Transaction ID: bridge-payment-123");
  mustInclude(receipt.text, "UETR: 550e8400-e29b-41d4-a716-446655440000");
  mustExclude(receipt.text, "Full amount received: 561.10 EUR");
});

Deno.test("under-review receipt includes available bank tracing fields without placeholders", () => {
  const receipt = render({
    company_name: "OMANIOR LTD",
    status: "in_review",
    amount: 500,
    currency: "EUR",
    reference: "deposit-reference",
    trace_id: "091000019876543",
    imad: "20260907BANK123456",
  });

  mustInclude(receipt.text, "Trace ID: 091000019876543");
  mustInclude(receipt.text, "IMAD: 20260907BANK123456");
  mustExclude(receipt.text, "UETR: null");
  mustExclude(receipt.html, "Clave de rastreo</td>");
});
