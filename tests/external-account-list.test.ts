import assert from "node:assert/strict";
import {
  extractBridgeExternalAccounts,
  normalizeBridgeExternalAccounts,
} from "../supabase/functions/_shared/providers/bridge-external-account-list.ts";

const iban = {
  id: "ext_iban_1",
  account_type: "iban",
  currency: "eur",
  account_owner_name: "Example Business",
  bank_name: "Example Bank",
  iban: { last_4: "200C", account_number: "sensitive" },
};

Deno.test("Bridge external-account list accepts provider pagination", () => {
  assert.deepEqual(extractBridgeExternalAccounts({ data: [iban] }), [iban]);
});

Deno.test("Bridge external-account list returns a masked client contract", () => {
  assert.deepEqual(normalizeBridgeExternalAccounts({ data: [iban] }), [{
    id: "ext_iban_1",
    bridge_external_account_id: "ext_iban_1",
    account_type: "iban",
    currency: "EUR",
    account_owner_name: "Example Business",
    bank_name: "Example Bank",
    last_4: "200C",
    rail: "sepa",
    status: "active",
  }]);
});

Deno.test("unknown provider envelopes fail closed to no beneficiaries", () => {
  assert.deepEqual(normalizeBridgeExternalAccounts({ result: [iban] }), []);
});
