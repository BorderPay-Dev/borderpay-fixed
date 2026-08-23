import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSha256Hex, stableStringify, verifySinkReceipt, type SinkReceipt } from "../_shared/certification-audit.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sameSecret(actual: string, expected: string): boolean {
  const left = new TextEncoder().encode(actual);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const workerToken = required("CERTIFICATION_AUDIT_WORKER_TOKEN");
    const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!sameSecret(suppliedToken, workerToken)) return json({ error: "unauthorized" }, 401);

    const sinkUrl = new URL(required("CERTIFICATION_AUDIT_SINK_URL"));
    if (sinkUrl.protocol !== "https:") throw new Error("CERTIFICATION_AUDIT_SINK_URL must use HTTPS");
    const sinkToken = required("CERTIFICATION_AUDIT_SINK_TOKEN");
    const signingSecret = required("CERTIFICATION_AUDIT_OUTBOUND_HMAC_SECRET");
    const sinkPublicKey = required("CERTIFICATION_AUDIT_SINK_PUBLIC_KEY_BASE64");
    const sinkKeyId = required("CERTIFICATION_AUDIT_SINK_KEY_ID");
    const retentionDays = Number(Deno.env.get("CERTIFICATION_AUDIT_MIN_RETENTION_DAYS") || "30");
    if (!Number.isInteger(retentionDays) || retentionDays < 30) throw new Error("minimum retention must be at least 30 days");

    const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: events, error: claimError } = await supabase.rpc("claim_certification_audit_deliveries", { p_limit: 50 });
    if (claimError) throw new Error(`audit claim failed: ${claimError.message}`);

    let delivered = 0;
    const failures: Array<{ event_id: string; error: string }> = [];
    for (const event of events || []) {
      try {
        const envelope = {
          schema_version: 1,
          project_ref: new URL(required("SUPABASE_URL")).hostname.split(".")[0],
          event,
        };
        const payload = stableStringify(envelope);
        const signature = await hmacSha256Hex(signingSecret, payload);
        const response = await fetch(sinkUrl, {
          method: "POST",
          headers: {
            "authorization": `Bearer ${sinkToken}`,
            "content-type": "application/json",
            "x-borderpay-audit-event": event.event_id,
            "x-borderpay-audit-signature": `sha256=${signature}`,
          },
          body: payload,
        });
        if (!response.ok) throw new Error(`sink returned HTTP ${response.status}`);
        const receipt = await response.json() as SinkReceipt;
        await verifySinkReceipt(receipt, {
          event_id: event.event_id,
          sequence_no: Number(event.sequence_no),
          event_hash: event.event_hash,
          key_id: sinkKeyId,
        }, sinkPublicKey, retentionDays);
        const { data: recorded, error: receiptError } = await supabase.rpc("record_certification_audit_receipt", {
          p_event_id: event.event_id,
          p_receipt_id: receipt.receipt_id,
          p_sink_key_id: receipt.key_id,
          p_signed_receipt: receipt.signature,
          p_stored_at: receipt.stored_at,
          p_retention_until: receipt.retention_until,
          p_object_lock_mode: receipt.object_lock_mode,
        });
        if (receiptError || recorded !== true) throw new Error(receiptError?.message || "receipt was not recorded");
        delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "delivery failed";
        failures.push({ event_id: event.event_id, error: message });
        await supabase.rpc("fail_certification_audit_delivery", { p_event_id: event.event_id, p_error: message });
      }
    }
    return json({ claimed: events?.length || 0, delivered, failures }, failures.length ? 503 : 200);
  } catch (error) {
    return json({ error: "audit_delivery_unavailable", detail: error instanceof Error ? error.message : "unknown error" }, 503);
  }
});
