import assert from "node:assert/strict";
import { stripBridgeTransferChainFields } from "../supabase/functions/_shared/providers/bridge-transfer-payload.ts";

for (const route of [
  { currency: "usdc", rail: "base", address: "0x1111111111111111111111111111111111111111" },
  { currency: "usdt", rail: "tron", address: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC" },
]) {
  Deno.test(`Bridge ${route.currency}/${route.rail} transfer never emits endpoint chain fields`, () => {
    const body = stripBridgeTransferChainFields({
      amount: "10.00",
      on_behalf_of: "customer_test",
      source: {
        payment_rail: "bridge_wallet",
        currency: route.currency,
        chain: route.rail,
        bridge_wallet_id: "wallet_test",
      },
      destination: {
        payment_rail: route.rail,
        currency: route.currency,
        chain: route.rail,
        to_address: route.address,
      },
    });

    assert.deepEqual(body, {
      amount: "10.00",
      on_behalf_of: "customer_test",
      source: {
        payment_rail: "bridge_wallet",
        currency: route.currency,
        bridge_wallet_id: "wallet_test",
      },
      destination: {
        payment_rail: route.rail,
        currency: route.currency,
        to_address: route.address,
      },
    });
  });
}
