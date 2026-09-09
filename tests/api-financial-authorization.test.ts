import {
  ApiFinancialAuthorizationError,
  assertSpendableWalletBalance,
  authorizeSingleTransferAmount,
  fixedFeeForPercent,
} from "../supabase/functions/_shared/api-financial-authorization.ts";
import {
  validateTransferOrPayout,
  validateVirtualAccountCreate,
} from "../supabase/functions/_shared/api-gateway-validators.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("virtual account contract requires an owned Bridge settlement wallet", () => {
  assert(
    !validateVirtualAccountCreate({
      customer_id: "cus_1",
      currency: "USD",
      destination: { rail: "base", currency: "USDC", address: "0xraw" },
    }).ok,
    "legacy raw-address contract remained accepted",
  );
  assert(
    validateVirtualAccountCreate({
      customer_id: "cus_1",
      currency: "USD",
      destination: {
        payment_rail: "base",
        currency: "USDC",
        bridge_wallet_id: "wal_1",
      },
    }).ok,
    "canonical Bridge wallet contract was rejected",
  );
});

Deno.test("transfer and payout contracts are narrow and route-specific", () => {
  const source = {
    payment_rail: "bridge_wallet",
    currency: "USDC",
    amount: "10.00",
    bridge_wallet_id: "wal_source",
  };
  assert(
    validateTransferOrPayout({
      source,
      destination: {
        payment_rail: "bridge_wallet",
        currency: "USDC",
        bridge_wallet_id: "wal_dest",
      },
      idempotency_key: "intent-0001",
    }, "transfer").ok,
    "owned wallet transfer was rejected",
  );
  assert(
    validateTransferOrPayout({
      source,
      destination: {
        payment_rail: "ach",
        currency: "USD",
        external_account_id: "ext_1",
      },
      idempotency_key: "intent-0002",
    }, "payout").ok,
    "owned external-account payout was rejected",
  );
  assert(
    !validateTransferOrPayout({
      source,
      destination: { payment_rail: "base", currency: "USDC", address: "0xraw" },
      developer_fee: { flat_amount: "0" },
      idempotency_key: "intent-0003",
    }, "payout").ok,
    "raw destination or caller fee was accepted",
  );
});

Deno.test("tenant cap is mandatory and compared without floating point", () => {
  let failure: unknown;
  try {
    authorizeSingleTransferAmount("1.00", null);
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof ApiFinancialAuthorizationError && failure.status === 403,
    "missing cap did not fail closed",
  );
  authorizeSingleTransferAmount(
    "999999999999.999999999999",
    "1000000000000.00",
  );
  failure = undefined;
  try {
    authorizeSingleTransferAmount(
      "1000000000000.000000000001",
      "1000000000000.00",
    );
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof ApiFinancialAuthorizationError,
    "exact cap overflow was accepted",
  );
});

Deno.test("server fee uses deterministic half-up cent rounding", () => {
  assert(fixedFeeForPercent("10.00", 100) === "0.10", "1% fee mismatch");
  assert(
    fixedFeeForPercent("10.50", 100) === "0.11",
    "half-cent rounding mismatch",
  );
});

Deno.test("wallet balance lookup fails closed and rejects insufficient funds", async () => {
  const builder = (result: { data: unknown; error: unknown }) => {
    const chain: any = {
      select: () => chain,
      or: () => chain,
      eq: () => chain,
      then: (resolve: (value: unknown) => void) => resolve(result),
    };
    return { from: () => chain };
  };
  let failure: unknown;
  try {
    await assertSpendableWalletBalance(
      builder({ data: null, error: { message: "down" } }),
      "u1",
      "USDC",
      "1.00",
    );
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof ApiFinancialAuthorizationError && failure.status === 503,
    "balance lookup error failed open",
  );
  failure = undefined;
  try {
    await assertSpendableWalletBalance(
      builder({
        data: [{ amount_minor: "500000", direction: "credit" }],
        error: null,
      }),
      "u1",
      "USDC",
      "1.00",
    );
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof ApiFinancialAuthorizationError && failure.status === 402,
    "insufficient balance was accepted",
  );
  await assertSpendableWalletBalance(
    builder({
      data: [{ amount_minor: "1000000", direction: "credit" }],
      error: null,
    }),
    "u1",
    "USDC",
    "1.00",
  );
});
