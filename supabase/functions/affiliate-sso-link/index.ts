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

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const raw = btoa(String.fromCharCode(...bytes));
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signHmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

function slugFromName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "affiliate";
}

function deriveAffiliateCode(userId: string, displayName: string): string {
  const tail = String(userId || "").replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${slugFromName(displayName).toUpperCase().slice(0, 8)}${tail ? `-${tail}` : ""}`;
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

  const { data: profile, error: pErr } = await supa
    .from("user_profiles")
    .select("id, email, full_name, account_type, bridge_customer_id, bridge_kyc_status")
    .eq("id", user.id)
    .maybeSingle();
  if (pErr) return json({ success: false, error: pErr.message }, 500);
  if (!profile) return json({ success: false, error: "Profile not found" }, 404);

  const isBusiness = String(profile.account_type || "").toLowerCase() === "business";
  let bridgeKybStatus: string | null = null;
  if (isBusiness) {
    const { data: biz } = await supa
      .from("business_profiles")
      .select("bridge_kyb_status")
      .eq("user_id", user.id)
      .maybeSingle();
    bridgeKybStatus = String(biz?.bridge_kyb_status || "").trim() || null;
  }

  const verificationStatus = isBusiness
    ? String(bridgeKybStatus || "not_started").toLowerCase()
    : String(profile.bridge_kyc_status || "not_started").toLowerCase();
  const verified = verificationStatus === "approved";

  // Ensure affiliate identity row exists and stays in sync with BorderPay user.
  // Lifecycle is portal-driven, but identity comes from BorderPay.
  const displayName = String(profile.full_name || profile.email || "BorderPay User");
  const email = String(profile.email || user.email || "").trim().toLowerCase();
  if (!email) return json({ success: false, error: "Profile email is required" }, 409);
  const code = deriveAffiliateCode(user.id, displayName);
  const baseStatus = verified ? "active" : "pending_verification";
  await supa.from("affiliates").upsert(
    {
      name: displayName,
      email,
      code,
      status: baseStatus,
      commission_rate: 10,
      tier: "Bronze",
    },
    { onConflict: "email" },
  );

  const secret = (Deno.env.get("AFFILIATE_SSO_SECRET") || "").trim();
  if (!secret) return json({ success: false, error: "AFFILIATE_SSO_SECRET is not configured" }, 500);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 5; // 5 minutes
  const payload = {
    iss: "borderpay-app",
    aud: "affiliate-portal",
    sub: String(user.id),
    email,
    name: displayName,
    account_type: isBusiness ? "business" : "individual",
    bridge_customer_id: profile.bridge_customer_id || null,
    verification_status: verificationStatus,
    verified,
    iat: now,
    exp,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHmacSha256(secret, signingInput);
  const jwt = `${signingInput}.${signature}`;

  const base = (Deno.env.get("AFFILIATE_PORTAL_URL") || "https://affiliate.borderpayafrica.com/login").trim();
  const url = new URL(base);
  url.searchParams.set("sso_token", jwt);
  url.searchParams.set("src", "borderpay_app");

  return json({
    success: true,
    data: {
      url: url.toString(),
      token_expires_at: new Date(exp * 1000).toISOString(),
      verification_status: verificationStatus,
      affiliate_status: baseStatus,
    },
  });
});

