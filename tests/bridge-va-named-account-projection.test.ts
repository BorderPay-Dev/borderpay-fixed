import { mergeBridgeSourceDepositInstructions } from "../supabase/functions/_shared/bridge-va-account-details.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nexpected=${JSON.stringify(expected)}\nactual=${JSON.stringify(actual)}`);
  }
}

Deno.test("Bridge named-account webhook updates only the EUR account-holder name", () => {
  const result = mergeBridgeSourceDepositInstructions({
    source_deposit_instructions: {
      currency: "eur", iban: "DE02120300000000202051", bic: "BYLADEM1001",
      bank_name: "Example Bank", bank_beneficiary_name: "Bridge Building S.A.", payment_rail: "sepa",
    },
  }, { source_deposit_instructions: { bank_beneficiary_name: "Acme Europe GmbH" } });
  assertEquals(result, {
    currency: "eur", iban: "DE02120300000000202051", bic: "BYLADEM1001",
    bank_name: "Example Bank", bank_beneficiary_name: "Acme Europe GmbH", payment_rail: "sepa",
  }, "partial Bridge update must preserve bank instructions");
});

Deno.test("empty Bridge name does not erase the current account-holder name", () => {
  const result = mergeBridgeSourceDepositInstructions({
    source_deposit_instructions: { iban: "FR7630006000011234567890189", account_holder_name: "Current Customer SAS" },
  }, { account_details: { source_deposit_instructions: { account_holder_name: " " } } });
  assertEquals(result, {
    iban: "FR7630006000011234567890189", account_holder_name: "Current Customer SAS",
  }, "blank provider fields must not destroy authoritative instructions");
});

Deno.test("new Bridge virtual account stores its complete named instructions", () => {
  const result = mergeBridgeSourceDepositInstructions({}, {
    source_deposit_instructions: { currency: "eur", iban: "NL91ABNA0417164300", beneficiary_name: "Jane Customer", payment_rail: "sepa" },
  });
  assertEquals(result, {
    currency: "eur", iban: "NL91ABNA0417164300", beneficiary_name: "Jane Customer", payment_rail: "sepa",
  }, "new VAs must use Bridge as the details source of truth");
});

Deno.test("top-level Bridge account-holder aliases project into deposit instructions", () => {
  const result = mergeBridgeSourceDepositInstructions({ source_deposit_instructions: { iban: "BE68539007547034" } }, {
    account_holder_name: "Named Customer BV",
  });
  assertEquals(result, { iban: "BE68539007547034", account_holder_name: "Named Customer BV" },
    "Bridge name aliases must reach the customer-facing instruction object");
});
