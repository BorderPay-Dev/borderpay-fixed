import assert from "node:assert/strict";
import { extractExternalAccountList } from "../utils/api/externalAccountList.ts";
import { extractBridgeExternalAccounts, normalizeBridgeExternalAccounts } from "../supabase/functions/_shared/providers/bridge-external-account-list.ts";

const gb = { id: "ext_gb_1", account_type: "gb", currency: "gbp" };
const us = { id: "ext_us_1", account_type: "us", currency: "usd" };

Deno.test("Bridge external-account list accepts the provider paginated envelope", () => {
  assert.deepEqual(extractBridgeExternalAccounts({ data: [gb, us] }), [gb, us]);
});

Deno.test("Bridge external-account list emits no records for an unknown envelope", () => {
  assert.deepEqual(extractBridgeExternalAccounts({ result: [gb] }), []);
});

Deno.test("Bridge list exposes only the masked GBP fields required by the UI", () => {
  assert.deepEqual(normalizeBridgeExternalAccounts({ data: [{
    ...gb,
    account_owner_name: "Example User",
    bank_name: "Example Bank",
    account: { last_4: "7788", account_number: "sensitive" },
    provider_internal_field: "do-not-expose",
  }] }), [{
    id: "ext_gb_1",
    bridge_external_account_id: "ext_gb_1",
    account_type: "gb",
    currency: "GBP",
    account_owner_name: "Example User",
    bank_name: "Example Bank",
    last_4: "7788",
    rail: "faster_payments",
    status: "active",
  }]);
});

Deno.test("client accepts canonical, bare-array, and legacy nested list envelopes", () => {
  assert.deepEqual(extractExternalAccountList({ external_accounts: [gb, us] }), [gb, us]);
  assert.deepEqual(extractExternalAccountList([gb, us]), [gb, us]);
  assert.deepEqual(extractExternalAccountList({ data: { external_accounts: [gb, us] } }), [gb, us]);
  assert.deepEqual(extractExternalAccountList({ data: [gb, us] }), [gb, us]);
});
