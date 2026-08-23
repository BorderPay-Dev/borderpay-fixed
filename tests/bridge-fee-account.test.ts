import { redactFeeAccountResponse, validateFeeAccountInput } from "../supabase/functions/_shared/bridge-fee-account.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("fee account input validates and builds the Bridge business payload", () => {
  const result = validateFeeAccountInput({
    account_owner_name: "BorderPay Africa",
    business_name: "BorderPay Africa",
    routing_number: "123456789",
    account_number: "123456789012",
  });
  assert(result.ok);
  assertEquals(result.payload.account_type, "us");
  assertEquals(result.payload.currency, "usd");
  assertEquals(result.payload.account_owner_type, "business");
  assertEquals((result.payload.account as Record<string, unknown>).checking_or_savings, "checking");
});

Deno.test("fee account input rejects malformed banking coordinates", () => {
  assertEquals(validateFeeAccountInput({ routing_number: "123", account_number: "abc" }).ok, false);
});

Deno.test("fee account response exposes descriptors but not bank coordinates", () => {
  const safe = redactFeeAccountResponse({
    id: "ext_123",
    active: true,
    currency: "usd",
    account_type: "us",
    account: { routing_number: "123456789", account_number: "123456789012", last_4: "9012" },
  });
  assertEquals(safe.last_4, "9012");
  const serialized = JSON.stringify(safe);
  assert(!serialized.includes("123456789"));
  assert(!serialized.includes("123456789012"));
});
