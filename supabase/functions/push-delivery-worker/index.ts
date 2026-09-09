import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_TOKEN = Deno.env.get("WORKER_AUTH_TOKEN") || "";
const FIREBASE_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function jwtRole(token: string): string {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    return String(JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")))?.role || "");
  } catch { return ""; }
}

function base64Url(value: Uint8Array | string): string {
  const binary = typeof value === "string" ? value : String.fromCharCode(...value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function pemBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

async function firebaseAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const privateKeyBytes = pemBytes(account.private_key);
  const privateKeyBuffer = privateKeyBytes.buffer.slice(
    privateKeyBytes.byteOffset,
    privateKeyBytes.byteOffset + privateKeyBytes.byteLength,
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.access_token) throw new Error(`firebase_oauth_${response.status}`);
  return String(payload.access_token);
}

async function sendFcm(account: ServiceAccount, accessToken: string, token: string, item: any) {
  const data = Object.fromEntries(Object.entries(item.data || {}).map(([key, value]) => [key, String(value ?? "")]));
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: item.title, body: item.body },
        data,
        android: { priority: "high", notification: { channel_id: "transaction_updates", visibility: "PRIVATE" } },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default", category: "TRANSACTION_UPDATE", "thread-id": "transactions" } },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  // Cron stores its independently rotatable bearer in app_config. Read it with
  // the service client so the value is never copied into source or logs.
  const { data: configuredWorkerToken } = await supabase.rpc("app_config_get", { p_key: "worker_auth_token" });
  if (!token || !(
    (WORKER_TOKEN && token === WORKER_TOKEN)
    || token === SERVICE_ROLE
    || token === String(configuredWorkerToken || "")
    || jwtRole(token) === "service_role"
  )) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  if (!FIREBASE_JSON) return json({ success: false, code: "firebase_service_account_missing" }, 503);

  let account: ServiceAccount;
  try {
    account = JSON.parse(FIREBASE_JSON);
    if (!account.project_id || !account.client_email || !account.private_key) throw new Error("invalid");
  } catch {
    return json({ success: false, code: "firebase_service_account_invalid" }, 503);
  }

  const body = await req.json().catch(() => ({}));
  if (body?.mode === "verify_credentials") {
    try {
      await firebaseAccessToken(account);
      return json({ success: true, firebase: "authenticated" });
    } catch {
      return json({ success: false, code: "firebase_oauth_failed" }, 502);
    }
  }
  const limit = Math.max(1, Math.min(Number(body?.limit || 50), 100));
  const { data: items, error: claimError } = await supabase.rpc("claim_push_deliveries", { p_limit: limit });
  if (claimError) return json({ success: false, error: claimError.message }, 500);
  if (!items?.length) return json({ success: true, claimed: 0, delivered: 0 });

  let accessToken: string;
  try { accessToken = await firebaseAccessToken(account); }
  catch (error) {
    for (const item of items) {
      await supabase.from("push_delivery_queue").update({
        status: "retry",
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        last_error: error instanceof Error ? error.message : "firebase_oauth_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    }
    return json({ success: false, code: "firebase_oauth_failed" }, 502);
  }

  let delivered = 0;
  for (const item of items) {
    const { data: devices } = await supabase.from("push_device_tokens")
      .select("id,token").eq("user_id", item.user_id).eq("active", true);
    if (!devices?.length) {
      await supabase.from("push_delivery_queue").update({ status: "no_devices", updated_at: new Date().toISOString() }).eq("id", item.id);
      continue;
    }

    let successes = 0;
    const errors: string[] = [];
    for (const device of devices) {
      const result = await sendFcm(account, accessToken, device.token, item);
      if (result.ok) { successes++; continue; }
      const serialized = JSON.stringify(result.payload).slice(0, 500);
      errors.push(`${result.status}:${serialized}`);
      if (result.status === 404 || serialized.includes("UNREGISTERED")) {
        await supabase.from("push_device_tokens").update({ active: false, updated_at: new Date().toISOString() }).eq("id", device.id);
      }
    }

    if (successes > 0) {
      delivered++;
      await supabase.from("push_delivery_queue").update({
        status: "delivered", delivered_at: new Date().toISOString(), last_error: errors.join(" | ") || null, updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    } else {
      const terminal = Number(item.attempt_count || 1) >= 5;
      const delayMinutes = Math.min(60, 2 ** Number(item.attempt_count || 1));
      await supabase.from("push_delivery_queue").update({
        status: terminal ? "failed" : "retry",
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        last_error: errors.join(" | ") || "push_delivery_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
    }
  }
  return json({ success: true, claimed: items.length, delivered });
});
