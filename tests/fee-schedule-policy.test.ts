import {
  AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT,
  BORDERPAY_DIRECT_VA_DEVELOPER_FEE_PERCENT_BY_CURRENCY,
  BRIDGE_DEVELOPER_FEE_PERCENT,
  borderPayDirectVaDeveloperFeePercent,
  bridgeDeveloperFeePercent,
} from "../supabase/functions/_shared/fees/schedule.ts";
import { buildBridgeTransferBody } from "../supabase/functions/_shared/providers/bridge-transfer-payload.ts";

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("BorderPay product fee matrix remains exact", () => {
  assertEquals(BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_business, 3, "business on-ramp");
  assertEquals(BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_individual, 3, "individual on-ramp");
  assertEquals(BORDERPAY_DIRECT_VA_DEVELOPER_FEE_PERCENT_BY_CURRENCY.USD, 3, "direct USD VA on-ramp");
  assertEquals(BORDERPAY_DIRECT_VA_DEVELOPER_FEE_PERCENT_BY_CURRENCY.EUR, 2.98, "direct EUR VA on-ramp");
  assertEquals(BORDERPAY_DIRECT_VA_DEVELOPER_FEE_PERCENT_BY_CURRENCY.GBP, 2.98, "direct GBP VA on-ramp");
  assertEquals(borderPayDirectVaDeveloperFeePercent("usd"), 3, "direct USD resolver");
  assertEquals(borderPayDirectVaDeveloperFeePercent("eur"), 2.98, "direct EUR resolver");
  assertEquals(borderPayDirectVaDeveloperFeePercent("gbp"), 2.98, "direct GBP resolver");
  assertEquals(BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_route, 0, "crypto route");
  assertEquals(BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp, 1, "external fiat off-ramp");
  assertEquals(AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT.business, 2, "Yellow Card business markup");
  assertEquals(AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT.individual, 2, "Yellow Card individual markup");
  assertEquals(bridgeDeveloperFeePercent("external_account_offramp", "USD", "individual"), 1, "individual fiat off-ramp");
  assertEquals(bridgeDeveloperFeePercent("external_account_offramp", "EUR", "business"), 1, "business fiat off-ramp");
});

Deno.test("external fiat fee keeps the established Bridge payload field", () => {
  const body = JSON.parse(JSON.stringify(buildBridgeTransferBody({
    on_behalf_of: "customer-id",
    source: { payment_rail: "bridge_wallet", currency: "USDC", bridge_wallet_id: "wallet-id", amount: "100.00" },
    destination: { payment_rail: "ach", currency: "USD", external_account_id: "external-account-id" },
    developer_fee: { flat_amount: "1.00" },
    idempotency_key: "fee-contract-test",
  }))) as Record<string, unknown>;
  assertEquals(body.developer_fee, "1.00", "Bridge fixed developer_fee field");
  assertEquals("developer_fee_percent" in body, false, "no external-fiat percentage field");
});
