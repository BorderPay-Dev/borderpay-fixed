import { yellowCardJitWebhookTarget } from "../supabase/functions/_shared/providers/yellowcard-jit-webhook.ts";

Deno.test("verified Yellow Card credit starts JIT fulfillment", () => {
  const target = yellowCardJitWebhookTarget({
    event: "CRYPTO_RECEIVE.COMPLETE",
    status: "complete",
    currentState: "TREASURY_SWEEP_SENT",
  });
  if (target !== "YELLOW_CARD_CREDITED") throw new Error("credit event was not projected");
});

Deno.test("Yellow Card Send completion is authoritative even when an intermediate callback is absent", () => {
  for (const currentState of ["TREASURY_SWEEP_SENT", "YELLOW_CARD_CREDITED", "DISPATCHED_TO_RAILS"] as const) {
    const target = yellowCardJitWebhookTarget({ event: "SEND.COMPLETE", status: "complete", currentState });
    if (target !== "COMPLETED") throw new Error(`completion blocked from ${currentState}`);
  }
});

Deno.test("Yellow Card pending event cannot claim credit before funding", () => {
  const target = yellowCardJitWebhookTarget({
    event: "SEND.PROCESSING",
    status: "processing",
    currentState: "TREASURY_SWEEP_SENT",
  });
  if (target !== null) throw new Error("unsigned or premature credit transition accepted");
});

Deno.test("Yellow Card completion cannot bypass send-intent funding", () => {
  for (const currentState of ["PENDING_SWEEP", "SEND_INTENT_CREATED"] as const) {
    const target = yellowCardJitWebhookTarget({ event: "SEND.COMPLETE", status: "complete", currentState });
    if (target !== null) throw new Error(`completion bypassed funding from ${currentState}`);
  }
});

Deno.test("Yellow Card Send failure locks funds pending authenticated refund", () => {
  const target = yellowCardJitWebhookTarget({
    event: "SEND.FAILED",
    status: "failed",
    currentState: "TREASURY_SWEEP_SENT",
  });
  if (target !== "REFUND_PENDING") throw new Error("failed Send released funds before refund reconciliation");
});
