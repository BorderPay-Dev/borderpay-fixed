import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ALLOWED_DIRECTION = new Set(["payout", "receive"]);
const ALLOWED_STATUS = new Set(["submitted", "processing", "completed", "failed", "reversed", "unknown"]);
const ALLOWED_SOURCE = new Set(["flutterwave"]);
const ALLOWED_CHANNEL = new Set(["bank", "mobile_money"]);

function toPositiveInt(value: unknown, fallback = 25, max = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

function parseIsoTimestamp(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured) {
    return json({
      success: false,
      code: "flutterwave_not_configured",
      error: "Flutterwave is not configured in this environment.",
      data: { capabilities: caps },
    }, 503);
  }
  if (!caps.payout_enabled && !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave transfer list endpoint is not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = toPositiveInt(body?.limit, 25, 100);
  const direction = String(body?.direction || "").trim().toLowerCase();
  const status = String(body?.status || "").trim().toLowerCase();
  const source = String(body?.source || "").trim().toLowerCase();
  const channel = String(body?.channel || "").trim().toLowerCase();
  const before = parseIsoTimestamp(body?.before);
  if (body?.before && !before) {
    return json({ success: false, error: "before must be a valid ISO timestamp" }, 400);
  }
  if (direction === "payout" && !caps.payout_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave payout rails are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }
  if (direction === "receive" && !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave receive rails are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  let effectiveDirection: "payout" | "receive" | null = direction ? (direction as "payout" | "receive") : null;

  let query = supa
    .from("flutterwave_transfers")
    .select([
      "id",
      "created_at",
      "updated_at",
      "direction",
      "source",
      "reference",
      "provider_transfer_id",
      "amount",
      "currency",
      "destination_country",
      "destination_currency",
      "channel",
      "status",
      "provider_status",
      "last_error",
      "last_synced_at",
      "provider_request_id",
      "provider_http_status",
    ].join(","))
    .eq("user_id", authData.user.id)
    .eq("source", "flutterwave")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!direction) {
    if (!caps.payout_enabled && caps.receive_enabled) {
      query = query.eq("direction", "receive");
      effectiveDirection = "receive";
    } else if (!caps.receive_enabled && caps.payout_enabled) {
      query = query.eq("direction", "payout");
      effectiveDirection = "payout";
    }
  }

  if (direction) {
    if (!ALLOWED_DIRECTION.has(direction)) {
      return json({ success: false, error: "direction must be payout or receive" }, 400);
    }
    query = query.eq("direction", direction);
  }
  if (status) {
    if (!ALLOWED_STATUS.has(status)) {
      return json({ success: false, error: "invalid status filter" }, 400);
    }
    query = query.eq("status", status);
  }
  if (source) {
    if (!ALLOWED_SOURCE.has(source)) {
      return json({ success: false, error: "source must be flutterwave" }, 400);
    }
  }
  if (channel) {
    if (!ALLOWED_CHANNEL.has(channel)) {
      return json({ success: false, error: "channel must be bank or mobile_money" }, 400);
    }
    query = query.eq("channel", channel);
  }
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) {
    return json({ success: false, code: "db_error", error: error.message || "Failed to list transfers" }, 500);
  }
  const rows = data || [];
  const tailCreatedAt = rows.length ? String(rows[rows.length - 1]?.created_at || "").trim() : "";
  const nextBefore = rows.length === limit && tailCreatedAt ? tailCreatedAt : null;

  return json({
    success: true,
    data: {
      list_scope: "transfers",
      response_contract_version: 1,
      provider: "flutterwave",
      capabilities: caps,
      rows,
      filters: {
        direction: effectiveDirection,
        status: status || null,
        source: "flutterwave",
        channel: channel || null,
        limit,
        before: before || null,
      },
      pagination: {
        has_more: Boolean(nextBefore),
        next_before: nextBefore,
        returned_count: rows.length,
      },
    },
  });
});
