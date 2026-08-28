import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider, BridgeProviderError } from "../_shared/providers/bridge.ts";
import { buildYellowCardJitFundingTransfer } from "../_shared/providers/yellowcard-jit.ts";
import {
  buildYellowCardDirectSettlementSendPayload,
  parseYellowCardDirectSettlementSendInstruction,
} from "../_shared/providers/yellowcard-payload.ts";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";
import { decryptYellowCardRecipient } from "../_shared/yellowcard-recipient-security.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const text = (value: unknown) => String(value ?? "").trim();
const flag = (name: string) => ["1", "true", "yes", "on", "enabled"].includes(text(Deno.env.get(name)).toLowerCase());

function equal(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function retryDelay(attempt: number): string {
  const seconds = Math.min(900, 15 * 2 ** Math.max(0, attempt));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function scheduleRetry(row: any, error: unknown) {
  const attempt = Number(row.attempt_count || 0) + 1;
  await db.from("yellowcard_jit_payouts").update({
    attempt_count: attempt,
    next_attempt_at: retryDelay(attempt),
    worker_lock_token: null,
    worker_locked_until: null,
    last_worker_error: String(error instanceof Error ? error.message : error).slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
}

async function scheduleReconciliation(row: any, providerState: string, delaySeconds = 30) {
  const { error } = await db.from("yellowcard_jit_payouts").update({
    provider_status: providerState.slice(0, 120),
    next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    worker_lock_token: null,
    worker_locked_until: null,
    last_worker_error: providerState === "payment_processed" || providerState === "completed" || providerState === "succeeded"
      ? "Bridge sweep completed; awaiting verified Yellow Card credit callback."
      : null,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("state", "TREASURY_SWEEP_SENT");
  if (error) throw error;
}

async function fail(row: any, code: string, detail: string) {
  const { error } = await db.rpc("transition_yellowcard_jit_payout", {
    p_payout_id: row.id,
    p_event_key: `worker:failed:${row.id}:${code}`,
    p_to_state: "FAILED",
    p_source: "worker",
    p_evidence: { code },
    p_failure_code: code,
    p_failure_detail: detail.slice(0, 1000),
  });
  if (error) throw error;
}

async function createSendIntent(row: any): Promise<any> {
  const key = text(Deno.env.get("YC_RECIPIENT_ENCRYPTION_KEY"));
  if (!key) throw new Error("yellow_card_recipient_encryption_unavailable");
  const envelope: any = await decryptYellowCardRecipient(
    row.recipient_ciphertext,
    row.sequence_id,
    row.recipient_key_version,
    key,
  );
  const metadata = row.metadata || {};
  const cryptoNetwork = row.settlement_network === "TRON" ? "TRC20" : "BASE";
  const payload = buildYellowCardDirectSettlementSendPayload({
    sequenceId: row.sequence_id,
    channelType: row.channel === "mobile_money" ? "momo" : "bank",
    localAmount: Number(row.destination_amount),
    country: row.destination_country,
    currency: row.destination_currency,
    reason: text(envelope.reason || "other").toLowerCase(),
    customerUID: row.user_id,
    customerType: envelope.sender.customerType,
    sender: envelope.sender.sender,
    destination: envelope.recipient,
    settlementInfo: {
      cryptoCurrency: row.settlement_asset,
      cryptoNetwork,
      cryptoAmount: Number(row.settlement_amount),
      refundAddress: text(metadata.refund_address),
    },
  });

  let result = await yellowCardFetch({ method: "POST", path: "/send", body: payload, timeoutMs: 30_000 });
  // A timeout, conflict, throttle or upstream failure can occur after Yellow
  // Card persisted the sequence. Resolve by the authoritative sequence ID
  // before considering a retry; never create a second payout by amount.
  if (!result.ok && ([408, 409, 429].includes(result.status) || result.status >= 500)) {
    result = await yellowCardFetch({
      method: "GET",
      path: `/send/sequence-id/${encodeURIComponent(row.sequence_id)}`,
      timeoutMs: 15_000,
    });
  }
  if (!result.ok) {
    const error: any = new Error(result.error || "yellow_card_send_intent_failed");
    error.status = result.status;
    throw error;
  }
  const instruction = parseYellowCardDirectSettlementSendInstruction(result.data, {
    sequenceId: row.sequence_id,
    localAmount: Number(row.destination_amount),
    settlementInfo: payload.settlementInfo as any,
  });
  if (Date.parse(instruction.expiresAt) - Date.now() < 120_000) {
    throw new Error("yellow_card_funding_window_too_short");
  }
  const { data, error } = await db.rpc("transition_yellowcard_jit_payout", {
    p_payout_id: row.id,
    p_event_key: `yellowcard:send-created:${instruction.providerTransactionId}`,
    p_to_state: "SEND_INTENT_CREATED",
    p_source: "worker",
    p_evidence: {
      sequence_id: instruction.sequenceId,
      provider_transaction_id: instruction.providerTransactionId,
      settlement_asset: instruction.cryptoCurrency,
      settlement_network: instruction.cryptoNetwork,
      settlement_amount: instruction.cryptoAmount,
      expires_at: instruction.expiresAt,
    },
    p_provider_status: "created",
    p_yellowcard_send_transaction_id: instruction.providerTransactionId,
    p_yellowcard_funding_address: instruction.walletAddress,
    p_yellowcard_funding_expires_at: instruction.expiresAt,
  });
  if (error) throw error;
  return data;
}

async function fundSendIntent(row: any): Promise<any> {
  if (!row.yellowcard_funding_address || !row.yellowcard_funding_expires_at) {
    throw new Error("yellow_card_funding_instruction_missing");
  }
  if (Date.parse(row.yellowcard_funding_expires_at) - Date.now() < 60_000) {
    await fail(row, "yellow_card_funding_instruction_expired", "Yellow Card funding instruction expired before Bridge accepted the transfer.");
    return null;
  }
  const metadata = row.metadata || {};
  const transfer = buildYellowCardJitFundingTransfer({
    customerId: text(metadata.bridge_customer_id),
    bridgeWalletId: row.bridge_wallet_id,
    settlementAsset: row.settlement_asset,
    settlementNetwork: row.settlement_network,
    settlementAmount: row.settlement_amount,
    yellowCardFundingAddress: row.yellowcard_funding_address,
    idempotencyKey: `yc-jit:${row.id}:fund`,
    scaApplied: metadata.sca_applied === true,
  });
  const result = await bridgeProvider.createTransfer(transfer);
  const { data, error } = await db.rpc("transition_yellowcard_jit_payout", {
    p_payout_id: row.id,
    p_event_key: `bridge:funding-created:${result.transfer_id}`,
    p_to_state: "TREASURY_SWEEP_SENT",
    p_source: "worker",
    p_evidence: {
      bridge_transfer_id: result.transfer_id,
      provider_state: result.state,
      yellowcard_funding_address: row.yellowcard_funding_address,
    },
    p_provider_status: result.state,
    p_bridge_transfer_id: result.transfer_id,
  });
  if (error) throw error;
  return data;
}


const BRIDGE_TERMINAL_FAILURES = new Set([
  "failed", "rejected", "canceled", "cancelled", "returned", "refunded",
]);
const BRIDGE_TERMINAL_SUCCESSES = new Set([
  "payment_processed", "completed", "succeeded",
]);

async function reconcileSweep(row: any): Promise<any> {
  if (!row.bridge_transfer_id) throw new Error("bridge_transfer_id_missing_for_reconciliation");
  const result = await bridgeProvider.getTransfer(row.bridge_transfer_id);
  if (result.transfer_id !== row.bridge_transfer_id) {
    throw new Error("bridge_transfer_identity_mismatch");
  }
  if (BRIDGE_TERMINAL_FAILURES.has(result.state)) {
    await fail(
      row,
      "bridge_jit_sweep_failed",
      `Bridge funding transfer reached terminal state ${result.state} before Yellow Card credit.`,
    );
    return { ...row, state: "FAILED" };
  }

  // A processed Bridge transfer is not proof that Yellow Card credited the
  // Send. Keep the reservation locked until an authenticated Yellow Card
  // CRYPTO_RECEIVE/SEND event advances the payout. Never synthesize credit.
  await scheduleReconciliation(
    row,
    result.state,
    BRIDGE_TERMINAL_SUCCESSES.has(result.state) ? 60 : 30,
  );
  return { ...row, provider_status: result.state };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, code: "method_not_allowed" }, 405);
  const configuredToken = text(Deno.env.get("YC_JIT_WORKER_TOKEN"));
  const serviceRole = text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const supplied = text(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "");
  if (!configuredToken || (!equal(supplied, configuredToken) && !equal(supplied, serviceRole))) {
    return json({ success: false, code: "unauthorized" }, 401);
  }
  const config = getYellowCardConfig();
  if (!flag("YC_PRODUCTION_SEND_ENABLED") || !flag("YC_JIT_PAYOUT_ENABLED") ||
      !config.configured || config.environment !== "production" || !config.production_host_pinned) {
    // Scheduled polling while operations has paused execution is healthy and
    // must not manufacture recurring 5xx noise in the project health signal.
    return json({ success: true, code: "yellow_card_jit_payout_paused", data: { paused: true } });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty scheduler body */ }
  const requestedBatchSize = Number(body.batch_size || 5);
  const batchSize = Number.isInteger(requestedBatchSize)
    ? Math.max(1, Math.min(requestedBatchSize, 10))
    : 5;
  const lockToken = crypto.randomUUID();
  const { data: rows, error } = await db.rpc("claim_yellowcard_jit_payouts", {
    p_lock_token: lockToken,
    p_limit: batchSize,
    p_lease_seconds: 90,
  });
  if (error) return json({ success: false, code: "yellow_card_jit_queue_unavailable" }, 503);

  const results: Array<Record<string, unknown>> = [];
  for (const initial of rows || []) {
    let row = initial;
    try {
      // Execute one irreversible provider leg per lease. The transition clears
      // the lease, and a fresh atomic claim is required before the next leg.
      // This prevents another worker from funding between local transitions.
      if (row.state === "PENDING_SWEEP") row = await createSendIntent(row);
      else if (row.state === "SEND_INTENT_CREATED") row = await fundSendIntent(row);
      else if (row.state === "TREASURY_SWEEP_SENT") row = await reconcileSweep(row);
      results.push({ payout_id: initial.id, state: row?.state || "FAILED" });
    } catch (error) {
      const status = Number((error as any)?.status || (error instanceof BridgeProviderError ? error.status : 0));
      const fatal = status >= 400 && status < 500 && status !== 408 && status !== 429;
      if (fatal || Number(initial.attempt_count || 0) >= 7) {
        await fail(initial, "yellow_card_jit_execution_failed", error instanceof Error ? error.message : "execution failed");
        results.push({ payout_id: initial.id, state: "FAILED" });
      } else {
        await scheduleRetry(initial, error);
        results.push({ payout_id: initial.id, state: initial.state, retry_scheduled: true });
      }
    }
  }
  return json({ success: true, data: { selected: rows?.length || 0, results } });
});
