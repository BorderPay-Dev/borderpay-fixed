import assert from "node:assert/strict";
import { stripBridgeTransferChainFields } from "../supabase/functions/_shared/providers/bridge-transfer-payload.ts";

Deno.test("Bridge transfer payload uses payment_rail and never endpoint chain fields", () => {
  const body = stripBridgeTransferChainFields({
    amount: "10.00",
    source: {
      payment_rail: "bridge_wallet",
      currency: "usdc",
      chain: "base",
      bridge_wallet_id: "wallet_test",
    },
    destination: {
      payment_rail: "base",
      currency: "usdc",
      chain: "base",
      to_address: "0x1111111111111111111111111111111111111111",
    },
  });

  assert.deepEqual(body, {
    amount: "10.00",
    source: {
      payment_rail: "bridge_wallet",
      currency: "usdc",
      bridge_wallet_id: "wallet_test",
    },
    destination: {
      payment_rail: "base",
      currency: "usdc",
      to_address: "0x1111111111111111111111111111111111111111",
    },
  });
});
