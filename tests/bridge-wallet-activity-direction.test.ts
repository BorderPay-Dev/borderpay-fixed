import assert from "node:assert/strict";
import { explicitBridgeWalletActivityDirection } from "../supabase/functions/_shared/bridge-wallet-activity-direction.ts";

Deno.test("Bridge direct_deposit is projected as a credit", () => {
  assert.equal(explicitBridgeWalletActivityDirection({ type: "direct_deposit" }), "credit");
});

Deno.test("Bridge deposit is projected as a credit", () => {
  assert.equal(explicitBridgeWalletActivityDirection({ type: "deposit" }), "credit");
});

Deno.test("Bridge withdrawal is projected as a debit", () => {
  assert.equal(explicitBridgeWalletActivityDirection({ type: "withdrawal" }), "debit");
});

Deno.test("unknown activity remains unresolved", () => {
  assert.equal(explicitBridgeWalletActivityDirection({ type: "new_provider_type" }), null);
});
