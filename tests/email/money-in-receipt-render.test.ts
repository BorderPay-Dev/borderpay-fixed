import { render as renderIndividualTransaction } from "../../supabase/functions/_shared/email-templates/individual/transaction-status.ts";
import { render as renderBusinessTransaction } from "../../supabase/functions/_shared/email-templates/business/transaction-status.ts";
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
