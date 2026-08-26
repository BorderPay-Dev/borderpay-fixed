import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || "3101");
const RELAY_TOKEN = String(process.env.YC_RELAY_TOKEN || "");
const YELLOW_CARD_BASE = "https://api.yellowcard.io/business";
const MAX_BODY_BYTES = 262_144;
const SEND_ENABLED = ["1", "true", "yes", "on", "enabled"].includes(
  String(process.env.YC_SEND_ENABLED || "").trim().toLowerCase(),
);

if (RELAY_TOKEN.length < 32) {
  console.error("YC_RELAY_TOKEN must contain at least 32 characters");
  process.exit(1);
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function tokenMatches(req) {
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(RELAY_TOKEN);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function allowedRoute(method, path, query) {
  const keys = Object.keys(query || {});
  if (method === "GET" && path === "/channels") return keys.every((key) => key === "country");
  if (method === "GET" && path === "/networks") return keys.every((key) => key === "country");
  if (method === "GET" && path === "/rates") return keys.every((key) => key === "currency");
  if (method === "GET" && /^\/receive\/sequence-id\/[0-9a-f-]{36}$/i.test(path)) return keys.length === 0;
  if (method === "GET" && /^\/send\/sequence-id\/[0-9a-f-]{36}$/i.test(path)) return keys.length === 0;
  if (method === "POST" && path === "/receive") return keys.length === 0;
  if (method === "POST" && path === "/send") return SEND_ENABLED && keys.length === 0;
  return false;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return reply(res, 200, { ok: true, service: "borderpay-yellowcard-relay" });
  }
  if (req.method !== "POST" || req.url !== "/v1/request") {
    return reply(res, 404, { ok: false, code: "not_found" });
  }
  if (!tokenMatches(req)) return reply(res, 401, { ok: false, code: "unauthorized" });

  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) req.destroy(new Error("payload_too_large"));
    else chunks.push(chunk);
  });
  req.on("error", () => {
    if (!res.headersSent) reply(res, 413, { ok: false, code: "payload_too_large" });
  });
  req.on("end", async () => {
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const method = String(input.method || "").toUpperCase();
      const path = String(input.path || "");
      const query = input.query && typeof input.query === "object" && !Array.isArray(input.query) ? input.query : {};
      if (!allowedRoute(method, path, query)) return reply(res, 403, { ok: false, code: "route_forbidden" });

      const upstreamAuthorization = String(req.headers["x-borderpay-yc-authorization"] || "");
      const upstreamTimestamp = String(req.headers["x-borderpay-yc-timestamp"] || "");
      if (!/^YcHmacV1\s+[^:]+:.+/.test(upstreamAuthorization) || !upstreamTimestamp) {
        return reply(res, 400, { ok: false, code: "invalid_upstream_auth" });
      }

      const url = new URL(`${YELLOW_CARD_BASE}${path}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
      const controller = new AbortController();
      const timeoutMs = Math.min(60_000, Math.max(1_000, Number(input.timeout_ms) || 15_000));
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = method === "POST" ? JSON.stringify(input.body ?? {}) : undefined;
        const upstream = await fetch(url, {
          method,
          headers: {
            accept: "application/json",
            authorization: upstreamAuthorization,
            "x-yc-timestamp": upstreamTimestamp,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body,
          signal: controller.signal,
        });
        const responseBody = await upstream.text();
        reply(res, upstream.status, responseBody || "{}", {
          "content-type": upstream.headers.get("content-type") || "application/json",
          ...(upstream.headers.get("x-request-id") ? { "x-request-id": upstream.headers.get("x-request-id") } : {}),
          ...(upstream.headers.get("x-correlation-id") ? { "x-correlation-id": upstream.headers.get("x-correlation-id") } : {}),
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      reply(res, timedOut ? 504 : 400, { ok: false, code: timedOut ? "upstream_timeout" : "invalid_request" });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`borderpay-yellowcard-relay listening on 127.0.0.1:${PORT}`);
});
