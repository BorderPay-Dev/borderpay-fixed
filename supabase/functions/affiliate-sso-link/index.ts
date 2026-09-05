import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const AFFILIATE_ORIGIN = "https://affiliate.borderpayafrica.com";
const ALLOWED_ORIGINS = new Set([
  "https://app.borderpayafrica.com",
  "https://borderpayafrica.com",
  "http://localhost:5173",
  "capacitor://localhost",
]);
const LOCKED_STATUSES = new Set(["frozen", "suspended", "blocked", "deactivated", "closed", "offboarded", "terminated"]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://app.borderpayafrica.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(req), "Content-Type": "application/json" },
});

function base64UrlEncode(input: Uint8Array): string {
  let value = "";
  for (const byte of input) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

async function signJwt(claims: Record<string, unknown>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${await hmacSha256(unsigned, secret)}`;
}

function verified(status: unknown): boolean {
  return String(status || "").trim().toLowerCase() === "approved";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { success: false, error: "POST only" }, 405);

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(req, { success: false, error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const secret = (Deno.env.get("AFFILIATE_SSO_SHARED_SECRET") || "").trim();
  if (!url || !serviceKey || secret.length < 32) {
    return json(req, { success: false, error: "Affiliate sign-in is temporarily unavailable" }, 503);
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.id || !user.email) return json(req, { success: false, error: "Authentication required" }, 401);
  if (!user.email_confirmed_at) return json(req, { success: false, error: "Verify your BorderPay email before continuing" }, 403);

  const { data: profile, error: profileError } = await db.from("user_profiles")
    .select("id,full_name,account_type,bridge_customer_id,bridge_kyc_status,account_status")
    .eq("id", user.id).maybeSingle();
  if (profileError || !profile) return json(req, { success: false, error: "BorderPay profile could not be verified" }, 403);

  const accountStatus = String(profile.account_status || "").trim().toLowerCase();
  if (LOCKED_STATUSES.has(accountStatus)) {
    return json(req, { success: false, code: "account_frozen", error: "This BorderPay account cannot access the affiliate portal" }, 403);
  }

  const accountType = String(profile.account_type || "individual").trim().toLowerCase();
  let verificationStatus = String(profile.bridge_kyc_status || "").trim().toLowerCase();
  let bridgeCustomerId = profile.bridge_customer_id || null;
  if (accountType === "business") {
    const { data: business, error: businessError } = await db.from("business_profiles")
      .select("bridge_customer_id,bridge_kyb_status")
      .eq("user_id", user.id).maybeSingle();
    if (businessError || !business) return json(req, { success: false, error: "Business verification could not be confirmed" }, 403);
    verificationStatus = String(business.bridge_kyb_status || "").trim().toLowerCase();
    bridgeCustomerId = business.bridge_customer_id || bridgeCustomerId;
  }
  if (!verified(verificationStatus)) {
    return json(req, { success: false, code: "verification_required", error: "Complete BorderPay verification before accessing the affiliate portal" }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.min(Math.max(Number(Deno.env.get("AFFILIATE_SSO_TTL_SECONDS") || 300), 60), 300);
  const jti = crypto.randomUUID();
  const expiresAt = new Date((now + ttlSeconds) * 1000).toISOString();
  const canonicalEmail = user.email.trim().toLowerCase();
  const { error: nonceError } = await db.from("affiliate_sso_nonces").insert({
    jti,
    user_id: user.id,
    expires_at: expiresAt,
  });
  if (nonceError) return json(req, { success: false, error: "Affiliate sign-in could not be started" }, 503);

  const signed = await signJwt({
    iss: "borderpay-app",
    aud: "borderpay-affiliate",
    iat: now,
    exp: now + ttlSeconds,
    jti,
    sub: user.id,
    email: canonicalEmail,
    full_name: String(profile.full_name || ""),
    account_type: accountType,
    bridge_customer_id: bridgeCustomerId,
    verification_status: "approved",
  }, secret);

  return json(req, {
    success: true,
    data: {
      url: `${AFFILIATE_ORIGIN}/login?token=${encodeURIComponent(signed)}`,
      correlation_id: jti,
      ttl_seconds: ttlSeconds,
      mode: "sso",
    },
  });
});
