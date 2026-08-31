import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test("USDC external wallets require a fee-bearing Bridge liquidation route", async () => {
  const walletSource = await Deno.readTextFile("supabase/functions/external-wallet/index.ts");
  const transferSource = await Deno.readTextFile("supabase/functions/bridge-transfer/index.ts");

  assertStringIncludes(walletSource, "bridgeProvider.createLiquidationAddress");
  assertStringIncludes(walletSource, "developer_fee_percent: ROUTE_DEVELOPER_FEE_PERCENT");
  assertEquals(walletSource.includes('bridge_payment_route_status: "direct_transfer"'), false);
  assertEquals(walletSource.includes('mode: "crypto_to_crypto_transfer"'), false);

  assertStringIncludes(transferSource, 'code: "external_wallet_route_required"');
  assertStringIncludes(transferSource, "cryptoRouteDepositAddress = routeDepositAddress");
  assertStringIncludes(transferSource, "address: cryptoRouteDepositAddress");
  assertStringIncludes(transferSource, "bridge_payment_route_id: cryptoRouteId");
  assertEquals(transferSource.includes("isUsdcBaseDirectPayout"), false);
});
