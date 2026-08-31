import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test("USDC external wallets use a zero-fee Bridge static-template deposit route", async () => {
  const walletSource = await Deno.readTextFile("supabase/functions/external-wallet/index.ts");
  const transferSource = await Deno.readTextFile("supabase/functions/bridge-transfer/index.ts");

  assertStringIncludes(walletSource, "bridgeProvider.createTransfer");
  assertStringIncludes(walletSource, "ROUTE_DEVELOPER_FEE_PERCENT > 0");
  assertStringIncludes(walletSource, "flexible_amount: true");
  assertStringIncludes(walletSource, "static_template: true");
  assertStringIncludes(walletSource, "allow_any_from_address: true");
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
