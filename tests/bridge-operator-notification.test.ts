import {
  bridgeOperatorEventState,
  shouldNotifyBridgeOperator,
} from "../supabase/functions/_shared/bridge-operator-notification.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, received ${String(actual)}`);
}

const scheduled = {
  eventType: "virtual_account.activity.created",
  payload: {
    event_object: {
      id: "e5a0c503-b290-4d9f-a307-944eb69e7758",
      virtual_account_id: "9f2c299e-48d5-4235-99eb-8dfc3223d0ce",
      deposit_id: null,
      type: "funds_scheduled",
      status: null,
      state: null,
      amount: "2.85",
      currency: "usd",
    },
  },
};

Deno.test("funds_scheduled is retained as evidence but never emailed as a transaction", () => {
  assertEquals(bridgeOperatorEventState(scheduled.payload), "funds_scheduled");
  assertEquals(shouldNotifyBridgeOperator(scheduled), false);
});

Deno.test("non-terminal Bridge VA activity states do not notify operators", () => {
  for (const type of ["funds_received", "payment_submitted", "pending", "created"]) {
    assertEquals(shouldNotifyBridgeOperator({
      eventType: "virtual_account.activity.created",
      payload: { event_object: { type, amount: "100", currency: "usd" } },
    }), false);
  }
});

Deno.test("terminal and compliance-actionable Bridge states notify operators", () => {
  for (const status of ["payment_processed", "completed", "failed", "under_review", "refunded"]) {
    assertEquals(shouldNotifyBridgeOperator({
      eventType: "virtual_account.activity.updated",
      payload: { event_object: { status, amount: "100", currency: "usd" } },
    }), true);
  }
});

Deno.test("non-financial Bridge resources never generate transaction email", () => {
  assertEquals(shouldNotifyBridgeOperator({
    eventType: "customer.updated",
    payload: { event_object: { status: "completed" } },
  }), false);
});
