import { assertBridgeFiatReturnPolicy } from "../supabase/functions/_shared/bridge-fiat-return-policy.ts";

function expectThrow(fn: () => unknown, text: string) {
  try {
    fn();
  } catch (error) {
    if (String((error as Error).message).includes(text)) return;
    throw error;
  }
  throw new Error(`expected error containing: ${text}`);
}

const now = new Date("2026-08-20T12:00:00.000Z");
const base = {
  requestedAmount: "5000.00",
  originalAmount: "5000.00",
  destinationCurrency: "usd",
  sourceCurrency: "usdc",
  paymentRail: "ach_push",
  depositCreatedAt: "2026-08-19T12:00:00.000Z",
  now,
};

Deno.test("ACH return requires the exact original amount", () => {
  const policy = assertBridgeFiatReturnPolicy(base);
  if (policy.amount !== "5000.00" || policy.confirmation !== "RETURN 5000.00 USD TO ORIGINAL SENDER") {
    throw new Error("ACH policy did not preserve exact cents and confirmation");
  }
  expectThrow(() => assertBridgeFiatReturnPolicy({ ...base, requestedAmount: "4450.00" }), "must equal");
});

Deno.test("Wire and SEPA may be partial but never exceed the deposit", () => {
  const wire = assertBridgeFiatReturnPolicy({ ...base, paymentRail: "wire", requestedAmount: "4450.00" });
  if (wire.amount !== "4450.00") throw new Error("partial wire return rejected");
  expectThrow(() => assertBridgeFiatReturnPolicy({ ...base, paymentRail: "sepa", requestedAmount: "5000.01" }), "cannot exceed");
});

Deno.test("unknown rails, non-USD funding and expired deposits fail closed", () => {
  expectThrow(() => assertBridgeFiatReturnPolicy({ ...base, paymentRail: "faster_payments" }), "only for ACH");
  expectThrow(() => assertBridgeFiatReturnPolicy({ ...base, destinationCurrency: "eur" }), "non-USD");
  expectThrow(() => assertBridgeFiatReturnPolicy({ ...base, depositCreatedAt: "2026-06-01T00:00:00.000Z" }), "60-day");
  expectThrow(() => assertBridgeFiatReturnPolicy({ ...base, requestedAmount: "5000.001" }), "at most two decimals");
});
