import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function base64UrlEncode(input: Uint8Array): string {
  let str = "";
  for (let i = 0; i < input.length; i++) str += String.fromCharCode(input[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

async function signJwt(claims: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();
  const h = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const p = base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const body = `${h}.${p}`;
  const signature = await hmacSha256(body, secret);
  return `${body}.${signature}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);

  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, full_name, account_type, bridge_customer_id, bridge_kyc_status, bridge_kyb_status")
    .eq("id", user.id)
    .maybeSingle();

  const fallbackUrl = (Deno.env.get("AFFILIATE_LOGIN_FALLBACK_URL") ?? "https://affiliate.borderpayafrica.com/login").trim();
  const ssoBase = (Deno.env.get("AFFILIATE_SSO_BASE_URL") ?? "").trim();
  const ssoSecret = (Deno.env.get("AFFILIATE_SSO_SHARED_SECRET") ?? "").trim();
  const ttlSeconds = Math.min(Math.max(Number(Deno.env.get("AFFILIATE_SSO_TTL_SECONDS") ?? 300), 60), 900);
  const correlationId = crypto.randomUUID();

  if (!ssoBase || !ssoSecret) {
    return json({
      success: true,
      data: {
        url: fallbackUrl,
        correlation_id: correlationId,
        ttl_seconds: 0,
        mode: "fallback",
      },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "borderpay-app",
    aud: "borderpay-affiliate",
    iat: now,
    exp: now + ttlSeconds,
    jti: correlationId,
    sub: String(profile?.id ?? user.id),
    email: String(profile?.email ?? user.email ?? ""),
    full_name: String(profile?.full_name ?? ""),
    account_type: String(profile?.account_type ?? "individual"),
    bridge_customer_id: profile?.bridge_customer_id ?? null,
    verification_status: String((profile?.account_type ?? "individual") === "business"
      ? (profile?.bridge_kyb_status ?? "not_started")
      : (profile?.bridge_kyc_status ?? "not_started")),
  };

  try {
    const signed = await signJwt(claims, ssoSecret);
    const joiner = ssoBase.includes("?") ? "&" : "?";
    const url = `${ssoBase}${joiner}token=${encodeURIComponent(signed)}`;
    return json({
      success: true,
      data: {
        url,
        correlation_id: correlationId,
        ttl_seconds: ttlSeconds,
        mode: "sso",
      },
    });
  } catch (e: any) {
    return json({
      success: true,
      data: {
        url: fallbackUrl,
        correlation_id: correlationId,
        ttl_seconds: 0,
        mode: "fallback",
        warning: String(e?.message || "sso_sign_failed"),
      },
    });
  }
});
