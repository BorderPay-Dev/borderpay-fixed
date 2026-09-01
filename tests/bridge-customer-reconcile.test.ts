import {
  deriveBridgeCustomerStates,
  normalizeBridgeCustomerState,
} from "../supabase/functions/_shared/bridge-customer-state.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`expected ${right}, received ${left}`);
}

Deno.test("unknown customer states are incomplete, never under review", () => {
  assertEquals(normalizeBridgeCustomerState("future_provider_state"), "incomplete");
  assertEquals(normalizeBridgeCustomerState(""), "not_started");
});

Deno.test("not-started verification remains not started", () => {
  assertEquals(deriveBridgeCustomerStates({ status: "not_started" }, "individual"), {
    account_status: "not_started",
    verification_status: "not_started",
  });
});

Deno.test("explicit review is the only generic review state", () => {
  assertEquals(deriveBridgeCustomerStates({ status: "under_review" }, "individual"), {
    account_status: "under_review",
    verification_status: "under_review",
  });
  assertEquals(deriveBridgeCustomerStates({ status: "pending" }, "business"), {
    account_status: "incomplete",
    verification_status: "incomplete",
  });
});

Deno.test("business KYB takes precedence over generic account status", () => {
  assertEquals(deriveBridgeCustomerStates({ status: "active", kyb_status: "incomplete" }, "business"), {
    account_status: "incomplete",
    verification_status: "incomplete",
  });
  assertEquals(deriveBridgeCustomerStates({ status: "active", kyb_status: "approved" }, "business"), {
    account_status: "approved",
    verification_status: "approved",
  });
});
