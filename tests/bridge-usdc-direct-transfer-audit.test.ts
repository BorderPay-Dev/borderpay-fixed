function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("USDC/Base external wallets use normal Bridge transfers without local fee injection", async () => {
  const transfer = await Deno.readTextFile("supabase/functions/bridge-transfer/index.ts");
  const wallets = await Deno.readTextFile("supabase/functions/external-wallet/index.ts");

  assert(
    transfer.includes('destinationCurrency === "USDC" && destinationChain === "base"'),
    "USDC/Base direct-transfer routing gate is missing",
  );
  assert(
    transfer.includes("? cryptoFinalAddress\n      : routeDepositAddress"),
    "USDC/Base must send to the saved final wallet address",
  );
  assert(
    !transfer.includes("BRIDGE_CRYPTO_FEE_OVERRIDES"),
    "customer fee overrides must not be injected into transfer requests",
  );
  assert(
    !transfer.includes(": cryptoDeveloperFee"),
    "normal crypto transfers must not receive an extra local developer fee",
  );
  assert(
    wallets.includes('bridge_payment_route_status: "direct_transfer"'),
    "new USDC/Base wallets must be stored as direct-transfer destinations",
  );
  assert(
    wallets.includes('mode: "crypto_to_crypto_transfer"'),
    "new USDC/Base wallets must record the Bridge transfer mode",
  );
});
