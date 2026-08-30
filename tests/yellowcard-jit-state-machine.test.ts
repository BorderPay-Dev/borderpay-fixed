function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sql = await Deno.readTextFile(new URL(
  "../supabase/migrations/20260827220000_yellowcard_jit_payout_state_machine.sql",
  import.meta.url,
));
const sendUi = await Deno.readTextFile(new URL(
  "../components/send/SendMoneyFlow.tsx",
  import.meta.url,
));
const backendApi = await Deno.readTextFile(new URL(
  "../utils/api/backendAPI.ts",
  import.meta.url,
));

Deno.test("Yellow Card JIT state machine is ordered and idempotent", () => {
  for (const state of [
    "PENDING_SWEEP",
    "SEND_INTENT_CREATED",
    "TREASURY_SWEEP_SENT",
    "YELLOW_CARD_CREDITED",
    "DISPATCHED_TO_RAILS",
    "COMPLETED",
    "FAILED",
  ]) assert(sql.includes(`'${state}'`), `missing ${state}`);
  assert(sql.includes("event_key text not null unique"), "events must be idempotent");
  assert(sql.includes("for update"), "transitions must lock the payout row");
  assert(sql.includes("invalid payout transition"), "invalid transitions must fail closed");
  assert(sql.includes("pg_advisory_xact_lock"), "wallet reservation must be serialized");
  assert(sql.includes("insufficient unreserved wallet balance"), "reservation must enforce spendable balance");
  assert(sql.includes("v_customer_debit_minor := v_amount_minor + v_borderpay_fee_minor"), "customer debit must include BorderPay fee");
  assert(sql.includes("(v_amount_minor * 200 + 5000) / 10000"), "BorderPay JIT fee must be exactly 200 bps");
  assert(sql.includes("sum(p.customer_debit_amount_minor)"), "active reservations must include the fee debit");
  assert(sql.includes("unique (user_id, idempotency_key)"), "payout intents must be idempotent");
  assert(
    sql.includes("v_row.state='PENDING_SWEEP' and p_to_state in ('SEND_INTENT_CREATED','FAILED')"),
    "provider Send intent must be created before treasury funding",
  );
  assert(sql.includes("for update skip locked"), "worker claims must be concurrency safe");
  assert(sql.includes("worker_locked_until < now()"), "abandoned worker claims must expire");
  assert(sql.includes("claim_yellowcard_jit_payouts"), "worker claim RPC is missing");
  assert(
    sql.includes("v_row.state='SEND_INTENT_CREATED' and p_to_state in ('TREASURY_SWEEP_SENT','FAILED')"),
    "treasury sweep must require a validated provider Send intent",
  );
});

Deno.test("Yellow Card SLA begins at verified provider credit", () => {
  assert(sql.includes("p_to_state='YELLOW_CARD_CREDITED'"), "credit transition missing");
  assert(sql.includes("interval '15 minutes'"), "mobile-money SLA missing");
  assert(sql.includes("interval '24 hours'"), "bank SLA missing");
  assert(!sql.includes("created_at + case when channel"), "SLA must not start at request creation");
});

Deno.test("ordinary Bridge payouts subtract active Yellow Card reservations", async () => {
  const bridge = await Deno.readTextFile(new URL(
    "../supabase/functions/bridge-transfer/index.ts",
    import.meta.url,
  ));
  assert(bridge.includes('.from("yellowcard_jit_payouts")'), "Bridge spendable balance ignores JIT reservations");
  assert(bridge.includes('["PENDING_SWEEP", "SEND_INTENT_CREATED", "TREASURY_SWEEP_SENT"]'), "active reservation states are incomplete");
  assert(bridge.includes("return ledgerBalance - reserved"), "reserved value is not removed from spendable balance");
});

Deno.test("Yellow Card recipient details are encrypted and event evidence is immutable", () => {
  assert(sql.includes("recipient_ciphertext text not null"), "plaintext recipient storage must not be used");
  assert(sql.includes("recipient_key_version text not null"), "encryption key version missing");
  assert(sql.includes("yellowcard_jit_payout_events is immutable"), "event ledger mutation guard missing");
  assert(sql.includes("before truncate"), "event ledger truncate guard missing");
});

Deno.test("production Send uses only the JIT endpoint and contains no sandbox execution path", () => {
  assert(!sendUi.includes("yellow-card-sandbox-usdc"), "fake USDC balance remains in Send");
  assert(!sendUi.includes("yellow-card-sandbox-usdt"), "fake USDT balance remains in Send");
  assert(!sendUi.includes("yellowCardSandboxTransaction"), "Send still calls the retired sandbox function");
  assert(!backendApi.includes("yellowCardSandboxTransaction"), "client API still exposes the retired sandbox function");
  assert(sendUi.includes("AFRICAN_SEND_EXECUTION_ENABLED = true"), "production African Send must be visible");
  assert(sendUi.includes("yellowCardJitPayout"), "Send must submit through the production JIT endpoint");
  assert(backendApi.includes("yellowCardJitPayout"), "client API must expose the production JIT endpoint");
  assert(sendUi.includes("resource: 'yellowcard_jit_payout'"), "JIT payments must bind regulatory SCA to the exact request");
});
