import { render as renderIndividualTransaction } from "../../supabase/functions/_shared/email-templates/individual/transaction-status.ts";
import { render as renderBusinessTransaction } from "../../supabase/functions/_shared/email-templates/business/transaction-status.ts";
import { render as renderIndividualActivity } from "../../supabase/functions/_shared/email-templates/individual/transaction-notification.ts";
import { render as renderBusinessActivity } from "../../supabase/functions/_shared/email-templates/business/transaction-notification.ts";
import { render as renderIndividualLimits } from "../../supabase/functions/_shared/email-templates/individual/virtual-account-limits.ts";
import { render as renderBusinessLimits } from "../../supabase/functions/_shared/email-templates/business/virtual-account-limits.ts";

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) throw new Error(`Expected rendered email to include: ${expected}`);
}

function assertExcludes(value: string, unexpected: string): void {
  if (value.includes(unexpected)) throw new Error(`Rendered email must not include: ${unexpected}`);
}

function receiptProps(sourceCurrency: "GBP" | "EUR" | "USD", sourceAmount: number, fee: number, destinationAmount: number) {
  return {
    status: "approved" as const,
    amount: destinationAmount,
    currency: "USDC",
    reference: `bridge-deposit-${sourceCurrency.toLowerCase()}`,
    occurred_at: "2026-08-03T09:28:44.887Z",
    source_currency: sourceCurrency,
    source_amount: sourceAmount,
    service_charge_amount: fee,
    available_amount: sourceAmount - fee,
    destination_currency: "USDC",
    destination_amount: destinationAmount,
    destination_rail: "base",
    source_rail: sourceCurrency === "GBP" ? "faster_payments" : sourceCurrency === "EUR" ? "sepa" : "ach",
    deposit_id: `deposit-${sourceCurrency.toLowerCase()}`,
    receipt_kind: "money_in_conversion" as const,
  };
}

Deno.test("GBP to USDC receipt keeps source and destination currencies separate", () => {
  const rendered = renderIndividualTransaction({ full_name: "Ada", ...receiptProps("GBP", 50, 1.25, 65.24) });
  assertIncludes(rendered.html, "Incoming funds");
  assertIncludes(rendered.html, "£50.00 GBP");
  assertIncludes(rendered.html, "Transaction fee");
  assertIncludes(rendered.html, "-£1.25 GBP");
  assertIncludes(rendered.html, "Converted amount / added to wallet");
  assertIncludes(rendered.html, "$65.24 USDC / Base");
  assertIncludes(rendered.html, "Approved / Completed");
  assertIncludes(rendered.html, "bridge-deposit-gbp");
  assertExcludes(rendered.html, "65.24 GBP");
  assertExcludes(rendered.html, 'bgcolor="#000000"');
});

Deno.test("EUR to USDC receipt keeps source and destination currencies separate", () => {
  const rendered = renderIndividualTransaction({ full_name: "Ada", ...receiptProps("EUR", 293, 7.33, 329.51) });
  assertIncludes(rendered.html, "€293.00 EUR");
  assertIncludes(rendered.html, "-€7.33 EUR");
  assertIncludes(rendered.html, "$329.51 USDC / Base");
  assertExcludes(rendered.html, "329.51 EUR");
});

Deno.test("USD to USDC receipt labels both USD and USDC legs", () => {
  const rendered = renderBusinessTransaction({ company_name: "BorderPay Review Ltd", ...receiptProps("USD", 10, 0.25, 9.75) });
  assertIncludes(rendered.html, "$10.00 USD");
  assertIncludes(rendered.html, "-$0.25 USD");
  assertIncludes(rendered.html, "$9.75 USDC / Base");
  assertExcludes(rendered.html, "9.75 USD</td>");
});

Deno.test("Bridge bank tracing evidence is rendered only when provider fields are present", () => {
  const base = receiptProps("USD", 100, 2, 98);
  const rendered = renderBusinessTransaction({
    company_name: "BorderPay Review Ltd",
    ...base,
    source_bank_name: "Sender Bank",
    source_bank_account: "•••• 1234",
    payment_reference_text: "Invoice 1042",
    receiving_bank_name: "Receiving Bank",
    receiving_account_name: "BorderPay Review Ltd",
    receiving_account_number: "•••• 9876",
    trace_id: "125109005699597",
    imad: "20260826ABC123",
    uetr: "550e8400-e29b-41d4-a716-446655440000",
    clave_de_rastreo: "MBAN010026082600000001",
  });
  for (const expected of [
    "Source bank", "Sender Bank", "Source account", "Invoice 1042",
    "Receiving bank", "Receiving account name", "Trace ID", "125109005699597",
    "IMAD", "UETR", "Clave de rastreo",
  ]) assertIncludes(rendered.html, expected);
  assertIncludes(rendered.text, "Bank reference: Invoice 1042");

  const withoutEvidence = renderIndividualTransaction({ full_name: "Ada", ...base });
  for (const absent of ["Source bank", "Receiving bank", "Trace ID", "IMAD", "UETR", "Clave de rastreo"]) {
    assertExcludes(withoutEvidence.html, absent);
  }
});

Deno.test("under-review VA email never presents a developer fee before payment submission", () => {
  const unsafePrematureProps = {
    status: "in_review" as const,
    amount: 2000,
    currency: "EUR",
    reference: "f9aacc1f-b034-4a6c-84e8-7984b0acb874",
    occurred_at: "2026-08-19T22:36:16.000Z",
    gross_amount: 2000,
    developer_fee_amount: 40,
    net_amount: 1960,
    source_currency: "EUR",
    source_amount: 2000,
    service_charge_amount: 40,
    available_amount: 1960,
    destination_currency: "USDC",
    destination_amount: 2277.05,
    deposit_id: "f9aacc1f-b034-4a6c-84e8-7984b0acb874",
  };

  for (const rendered of [
    renderBusinessTransaction({ company_name: "ELVARIS SOFTWARE LTD", ...unsafePrematureProps }),
    renderIndividualTransaction({ full_name: "Ada", ...unsafePrematureProps }),
  ]) {
    assertIncludes(rendered.html, "Transaction under review");
    assertIncludes(rendered.html, "2,000.00 EUR");
    assertIncludes(rendered.text, "Amount: 2,000.00 EUR");
    assertExcludes(rendered.html, "Transaction fee");
    assertExcludes(rendered.html, "Service charge");
    assertExcludes(rendered.html, "Net amount");
    assertExcludes(rendered.html, "40.00 EUR");
    assertExcludes(rendered.html, "1,960.00 EUR");
    assertExcludes(rendered.html, "$2,277.05");
  }
});

Deno.test("successful Bridge wallet payout renders a dedicated money-out receipt", () => {
  for (const rendered of [
    renderBusinessActivity({
      company_name: "ELVARIS SOFTWARE LTD",
      direction: "debit",
      amount: 100,
      currency: "USDC",
      reference: "bridge-money-out-1",
      description: "Payment sent",
    }),
    renderIndividualActivity({
      full_name: "Ada",
      direction: "debit",
      amount: 100,
      currency: "USDC",
      reference: "bridge-money-out-1",
      description: "Payment sent",
    }),
  ]) {
    assertIncludes(rendered.html, "Money out");
    assertIncludes(rendered.html, "Payment sent");
    assertIncludes(rendered.html, "bridge-money-out-1");
    assertExcludes(rendered.html, "just received funds");
  }
});

Deno.test("virtual account limits templates use the clean white email surface", () => {
  const accounts = [{ currency: "GBP", rail: "Faster Payments", account_label: "GBP - Faster Payments" }];
  for (const rendered of [
    renderIndividualLimits({ full_name: "Ada", virtual_accounts: accounts }),
    renderBusinessLimits({ company_name: "BorderPay Review Ltd", virtual_accounts: accounts }),
  ]) {
    assertIncludes(rendered.html, "background-color:#FFFFFF");
    assertIncludes(rendered.html, "color:#111513");
    assertExcludes(rendered.html, 'bgcolor="#000000"');
  }
});
