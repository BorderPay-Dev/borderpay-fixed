import assert from "node:assert/strict";
import test from "node:test";

import { bridgeTransferCustomerId } from "../supabase/functions/_shared/bridge-transfer-owner.ts";

test("resolves Bridge transfer owner from on_behalf_of", () => {
  assert.equal(
    bridgeTransferCustomerId({ on_behalf_of: "bridge-customer-id" }),
    "bridge-customer-id",
  );
});

test("keeps customer_id precedence and rejects an absent owner", () => {
  assert.equal(
    bridgeTransferCustomerId({
      customer_id: "canonical-customer",
      on_behalf_of: "fallback-customer",
    }),
    "canonical-customer",
  );
  assert.equal(bridgeTransferCustomerId({ source: {}, destination: {} }), null);
});
