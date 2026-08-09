import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getYellowCardConfig, yellowCardFetch } from "../_shared/providers/yellowcard-client.ts";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YC_ALLOWED_TEST_USER_IDS = String(Deno.env.get("YC_ALLOWED_TEST_USER_IDS") || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const YC_ALLOWED_TEST_EMAILS = new Set(
  [
    "adhiamboadhiambo22@gmail.com",
    "appreview.individual@borderpayafrica.com",
    "appreview.business@borderpayafrica.com",
    ...String(Deno.env.get("YC_ALLOWED_TEST_EMAILS") || "").split(","),
  ].map((email) => email.trim().toLowerCase()).filter(Boolean),
);

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Action = "config" | "channels" | "networks" | "rates";

function jwtRole(token: string): string {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return String(JSON.parse(atob(padded))?.role || "");
  } catch {
    return "";
  }
}

async function authorize(req: Request): Promise<{ ok: true; actorId: string; isAdmin: boolean } | { ok: false; status: number; body: unknown }> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, body: { success: false, error: "Authorization required" } };

  // The Edge gateway verifies legacy JWTs before invocation. Accept the
  // verified service-role claim as well as the runtime secret's exact value;
  // projects can rotate API keys without redeploying the platform secret.
  if ((SUPABASE_SERVICE_ROLE && token === SUPABASE_SERVICE_ROLE) || jwtRole(token) === "service_role") {
    return { ok: true, actorId: "service_role", isAdmin: true };
  }

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user?.id) return { ok: false, status: 401, body: { success: false, error: "Unauthorized" } };

  const { data: adminRow } = await supa
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin = Boolean(adminRow?.user_id);
  const explicitlyAllowed = YC_ALLOWED_TEST_USER_IDS.includes(user.id);
  const emailAllowed = YC_ALLOWED_TEST_EMAILS.has(String(user.email || "").trim().toLowerCase());

  if (!isAdmin && !explicitlyAllowed && !emailAllowed) {
    return {
      ok: false,
      status: 403,
      body: {
        success: false,
        code: "yellow_card_sandbox_internal_only",
        error: "Yellow Card sandbox diagnostics are internal-only.",
      },
    };
  }

  return { ok: true, actorId: user.id, isAdmin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = await authorize(req);
  if (!auth.ok) return json(auth.body, auth.status);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const config = getYellowCardConfig();
  if (!config.configured) {
    return json({
      success: false,
      code: "yellow_card_not_configured",
      error: "Yellow Card sandbox keys are not configured on this Supabase project.",
      data: { config },
    }, 503);
  }

  if (config.environment !== "sandbox") {
    return json({
      success: false,
      code: "yellow_card_production_blocked",
      error: "This diagnostic function is sandbox-only and will not call Yellow Card production.",
      data: { config },
    }, 403);
  }

  const action = String(body?.action || "channels").trim().toLowerCase() as Action;
  const country = String(body?.country || "").trim().toUpperCase();
  const currency = String(body?.currency || "").trim().toUpperCase();
  const channelId = String(body?.channelId || body?.channel_id || "").trim();

  if (action === "config") {
    return json({
      success: true,
      data: {
        actor_id: auth.actorId,
        internal_only: true,
        allowed_test_user_count: YC_ALLOWED_TEST_USER_IDS.length,
        allowed_test_email_count: YC_ALLOWED_TEST_EMAILS.size,
        config,
      },
    });
  }

  if (action === "channels") {
    const res = await yellowCardFetch({
      method: "GET",
      path: "/channels",
      query: country ? { country } : undefined,
    });
    const payload = res.data as any;
    const channels = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.channels) ? payload.channels : []);
    const activeChannels = channels.filter((channel: any) => {
      const apiStatus = String(channel?.apiStatus || channel?.status || "").toLowerCase();
      return apiStatus === "active";
    });
    return json({
      success: res.ok,
      code: res.ok ? "ok" : res.error,
      error: res.ok ? undefined : res.error,
      data: {
        config,
        request: { action, country: country || null },
        provider_status: { http_status: res.status, request_id: res.requestId || null },
        channel_count: channels.length,
        active_channel_count: activeChannels.length,
        channels: res.data,
      },
    }, res.ok ? 200 : (res.status >= 400 && res.status < 600 ? res.status : 502));
  }

  if (action === "networks") {
    const res = await yellowCardFetch({
      method: "GET",
      path: "/networks",
      query: {
        ...(country ? { country } : {}),
        ...(channelId ? { channelId } : {}),
      },
    });
    const payload = res.data as any;
    const networks = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.networks) ? payload.networks : []);
    return json({
      success: res.ok,
      code: res.ok ? "ok" : res.error,
      error: res.ok ? undefined : res.error,
      data: {
        config,
        request: { action, country: country || null, channel_id: channelId || null },
        provider_status: { http_status: res.status, request_id: res.requestId || null },
        network_count: networks.length,
        networks: res.data,
      },
    }, res.ok ? 200 : (res.status >= 400 && res.status < 600 ? res.status : 502));
  }

  if (action === "rates") {
    const res = await yellowCardFetch({
      method: "GET",
      path: "/rates",
      query: currency ? { currency } : undefined,
    });
    const rates = Array.isArray((res.data as any)?.rates) ? (res.data as any).rates : [];
    return json({
      success: res.ok,
      code: res.ok ? "ok" : res.error,
      error: res.ok ? undefined : res.error,
      data: {
        config,
        request: { action, currency: currency || null },
        provider_status: { http_status: res.status, request_id: res.requestId || null },
        rate_count: rates.length,
        rates: res.data,
      },
    }, res.ok ? 200 : (res.status >= 400 && res.status < 600 ? res.status : 502));
  }

  return json({ success: false, error: "Unsupported action. Use config, channels, networks, or rates." }, 400);
});
