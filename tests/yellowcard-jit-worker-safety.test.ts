function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const worker = await Deno.readTextFile(new URL(
  "../supabase/functions/yellowcard-jit-worker/index.ts",
  import.meta.url,
));

Deno.test("Yellow Card JIT worker is claimed, gated, and sequence-correlated", () => {
  assert(worker.includes('db.rpc("claim_yellowcard_jit_payouts"'), "worker does not use the atomic claim RPC");
  assert(worker.includes('flag("YC_PRODUCTION_SEND_ENABLED")'), "production Send gate missing");
  assert(worker.includes('flag("YC_JIT_PAYOUT_ENABLED")'), "JIT activation gate missing");
  assert(worker.includes("/send/sequence-id/"), "ambiguous Send recovery is not sequence-correlated");
  assert(!worker.includes("findByAmount"), "worker must never correlate deposits by amount");
  assert(!worker.includes("TREASURY_WALLET_ADDRESS"), "worker must use the provider-issued funding address");
});

Deno.test("Yellow Card JIT worker executes only one irreversible leg per lease", () => {
  assert(
    worker.includes('else if (row.state === "SEND_INTENT_CREATED")'),
    "worker can create and fund a Send under the same released lease",
  );
  assert(worker.includes("yellowcard_funding_address: row.yellowcard_funding_address"), "funding does not use validated address");
  assert(worker.includes('idempotencyKey: `yc-jit:${row.id}:fund`'), "Bridge funding idempotency is missing");
});
