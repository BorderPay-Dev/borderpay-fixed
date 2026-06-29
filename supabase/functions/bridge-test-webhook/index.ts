import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertBridgeIngressDecision, evaluateBridgeIngressEvent } from "../_shared/bridge-ingress-evaluator.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TEST_TOKEN            = Deno.env.get("BRIDGE_TEST_WEBHOOK_TOKEN") ?? "";
const SYNTHETIC_EVENTS_ENABLED = (Deno.env.get("SYNTHETIC_EVENTS_ENABLED") ?? "false").toLowerCase() === "true";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function authOk(req: Request): boolean {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!TEST_TOKEN && token === TEST_TOKEN;
}

function normId(x: unknown): string {
  return String(x ?? "").trim().replace(/[^a-zA-Z0-9:_\-.]/g, "_");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      error: "Invalid request method",
      code: "method_not_allowed",
      expected_method: "POST",
    }, 405);
  }
  if (!SYNTHETIC_EVENTS_ENABLED) {
    return json({
      error: "Synthetic events are disabled",
      code: "synthetic_mode_disabled",
    }, 403);
  }
  if (!authOk(req)) {
    return json({
      error: "Unauthorized",
      code: "invalid_test_token",
    }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch {
    return json({
      error: "Invalid JSON payload",
      code: "invalid_json_payload",
    }, 400);
  }

  const testCaseId = normId(body?.test_case_id);
  const bridgeEventIdRaw = normId(body?.event_id ?? body?.payload?.id ?? body?.id);
  if (!testCaseId || !bridgeEventIdRaw) {
    return json({
      error: "test_case_id and event_id (or payload.id) are required",
      code: "invalid_synthetic_payload",
    }, 400);
  }

  const rawPayload = {
    ...(body?.payload ?? {}),
    id: body?.payload?.id ?? body?.event_id ?? body?.id ?? bridgeEventIdRaw,
    type: body?.payload?.type ?? body?.event_type ?? body?.payload?.event_type ?? "unknown",
  };
  const evalRes = evaluateBridgeIngressEvent({
    source: "bridge_test",
    eventIdRaw: bridgeEventIdRaw,
    eventTypeRaw: String(body?.event_type ?? rawPayload.type ?? "unknown"),
    payload: rawPayload,
    signatureOk: true,
    replayWindowOk: true,
    parseOk: true,
  });
  assertBridgeIngressDecision(evalRes);
  if (evalRes.decision === "reject") {
    return json({
      error: "Rejected synthetic event",
      code: "synthetic_event_rejected",
      reason_code: evalRes.reason_code,
    }, 400);
  }

  const bridgeEventId = `test:${testCaseId}:${bridgeEventIdRaw}`;
  const nowIso = new Date().toISOString();

  const payload = {
    ...evalRes.normalized_payload,
    test_origin: true,
    test_case_id: testCaseId,
    replay_group_key: String(body?.replay_group_key ?? `${testCaseId}:${bridgeEventIdRaw}`),
    bridge_event_id: bridgeEventIdRaw,
    evaluated_reason_code: evalRes.reason_code,
    routing_target: evalRes.routing_target,
    route_bucket: evalRes.route_bucket,
    idempotency_key: evalRes.idempotency_key,
    injected_at: nowIso,
  };

  const payloadHash = await sha256Hex(JSON.stringify(payload));

  // Canonical ingest path: synthetic events use the same queue ingest RPC as
  // production Bridge webhooks, with a tagged synthetic event namespace.
  const { data: ingest, error: rpcErr } = await supa.rpc("ingest_bridge_event", {
    p_event_id: bridgeEventId,
    p_event_type: evalRes.derived_event_type,
    p_signature_ok: true,
    p_payload: payload,
    p_payload_hash: payloadHash,
  });
  if (rpcErr) {
    return json({ error: "synthetic_ingest_failed", code: "ingest_failed" }, 500);
  }
  const row = Array.isArray(ingest) ? ingest[0] : ingest;
  const queueEventId = `bridge:${bridgeEventId}`;
  if (row?.was_rejected) {
    return json({
      error: "Synthetic ingest rejected",
      code: "synthetic_ingest_rejected",
      bridge_event_id: bridgeEventId,
    }, 401);
  }
  if (row?.was_duplicate) {
    return json({ status: "duplicate", bridge_event_id: bridgeEventId, queue_event_id: queueEventId }, 200);
  }
  if (!row?.queued) {
    return json({
      error: "Synthetic ingest not queued",
      code: "synthetic_ingest_not_queued",
      bridge_event_id: bridgeEventId,
    }, 500);
  }

  return json({
    status: "queued",
    bridge_event_id: bridgeEventId,
    queue_event_id: queueEventId,
    pending_event_id: row?.pending_id ?? null,
  }, 200);
});
