import assert from "node:assert/strict";
import { buildBridgeTransferBody } from "../supabase/functions/_shared/providers/bridge-transfer-payload.ts";

Deno.test("Bridge transfer payload never serializes source.chain or destination.chain", () => {
  const body = buildBridgeTransferBody({
    on_behalf_of: "customer_test",
    source: {
      payment_rail: "bridge_wallet",
      currency: "USDC",
      chain: "BASE",
      amount: "10.00",
      bridge_wallet_id: "wallet_test",
    },
    destination: {
      payment_rail: "base",
      currency: "USDC",
      chain: "BASE",
      address: "0x1111111111111111111111111111111111111111",
    },
    idempotency_key: "bp-transfer-payload-test",
  });

  const source = body.source as Record<string, unknown>;
  const destination = body.destination as Record<string, unknown>;
  assert.equal("chain" in source, false);
  assert.equal("chain" in destination, false);
  assert.deepEqual(source, {
    payment_rail: "bridge_wallet",
    currency: "usdc",
    bridge_wallet_id: "wallet_test",
  });
  assert.deepEqual(destination, {
    payment_rail: "base",
    currency: "usdc",
    to_address: "0x1111111111111111111111111111111111111111",
  });
});

Deno.test("Bridge EEA SCA attestation uses the corrected nested initiation contract", () => {
  const body = buildBridgeTransferBody({
    on_behalf_of: "customer_eea",
    source: {
      payment_rail: "bridge_wallet",
      currency: "USDC",
      amount: "10.0",
      bridge_wallet_id: "wallet_eea",
    },
    destination: {
      payment_rail: "base",
      currency: "USDC",
      address: "0x1111111111111111111111111111111111111111",
    },
    sca_attestation: {
      outcome: "sca_used",
      channel: "other",
      subchannel: "remote",
    },
    idempotency_key: "bridge-eea-sca-payload-test",
  });

  assert.deepEqual(body.initiation, {
    channel: "other",
    subchannel: "remote",
    attestations: { sca: { outcome: "sca_used" } },
  });
});
