import { render } from "../../supabase/functions/_shared/email-templates/business/transaction-status.ts";

function mustInclude(value: string, expected: string): void {
  if (!value.includes(expected)) throw new Error(`Expected rendered receipt to include: ${expected}`);
}

function mustExclude(value: string, forbidden: string): void {
  if (value.includes(forbidden)) throw new Error(`Rendered receipt must not include: ${forbidden}`);
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
  });

  mustInclude(receipt.text, "Incoming funds: 500.00 EUR");
  mustInclude(receipt.text, "Service charge: 14.90 EUR");
  mustInclude(receipt.text, "Available for conversion: 485.10 EUR");
  mustInclude(receipt.text, "Outgoing funds: 561.10 USDC");
  mustExclude(receipt.text, "Full amount received: 561.10 EUR");
});
