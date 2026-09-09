import { bridgeReceiptBreakdown } from "../supabase/functions/_shared/bridge-receipt-breakdown.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

Deno.test("Bridge receipt does not subtract developer fee twice", () => {
  const result = bridgeReceiptBreakdown({
    // Observed Bridge activity amount is already the outgoing/net amount.
    amount: "97.50",
    receipt: {
      initial_amount: "100.00",
      developer_fee_amount: "2.50",
      final_amount: "97.50",
    },
  }, "USD");

  assertEquals(result?.grossMinor, 10000n, "gross incoming funds");
  assertEquals(result?.developerFeeMinor, 250n, "developer fee");
  assertEquals(result?.exchangeFeeMinor, 0n, "exchange fee");
  assertEquals(result?.netMinor, 9750n, "net wallet amount");
});

Deno.test("Bridge receipt derives gross from an explicitly net top-level amount", () => {
  const result = bridgeReceiptBreakdown({
    amount: "97.50",
    developer_fee_amount: "2.50",
  }, "USD");

  assertEquals(result?.grossMinor, 10000n, "derived gross incoming funds");
  assertEquals(result?.netMinor, 9750n, "top-level net amount");
});

Deno.test("Bridge in-review EUR VA payload preserves Bridge gross and pending fee components", () => {
  const first = bridgeReceiptBreakdown({
    amount: "2000.0",
    subtotal_amount: "2000.0",
    developer_fee_amount: "40.0",
    exchange_fee_amount: "0.0",
    product_type: "virtual_account",
    type: "in_review",
  }, "EUR");
  const second = bridgeReceiptBreakdown({
    amount: "2200.0",
    subtotal_amount: "2200.0",
    developer_fee_amount: "44.0",
    exchange_fee_amount: "0.0",
    product_type: "virtual_account",
    type: "in_review",
  }, "EUR");

  assertEquals(first?.grossMinor, 200000n, "first gross incoming funds");
  assertEquals(first?.developerFeeMinor, 4000n, "first developer fee");
  assertEquals(first?.netMinor, 196000n, "first net amount");
  assertEquals(second?.grossMinor, 220000n, "second gross incoming funds");
  assertEquals(second?.developerFeeMinor, 4400n, "second developer fee");
  assertEquals(second?.netMinor, 215600n, "second net amount");
});

Deno.test("Bridge pre-conversion VA payload fails closed when gross fields disagree", () => {
  let rejected = false;
  try {
    bridgeReceiptBreakdown({
      amount: "2000.0",
      subtotal_amount: "1960.0",
      developer_fee_amount: "40.0",
      product_type: "virtual_account",
      type: "in_review",
    }, "EUR");
  } catch (error) {
    rejected = error instanceof Error && error.message === "bridge_webhook_receipt_amounts_inconsistent";
  }
  assertEquals(rejected, true, "inconsistent in-review payload must be rejected");
});

Deno.test("Bridge receipt preserves fee-free same-token value", () => {
  const result = bridgeReceiptBreakdown({
    amount: "25.000000",
    receipt: { initial_amount: "25.000000", final_amount: "25.000000" },
  }, "USDT");

  assertEquals(result?.grossMinor, 25000000n, "stablecoin gross");
  assertEquals(result?.netMinor, 25000000n, "stablecoin net");
});
