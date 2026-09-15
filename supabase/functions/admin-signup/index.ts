import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ADMIN_ORIGINS = new Set([
  "https://admin.borderpayafrica.com",
  "http://localhost:5173",
]);
const allowedOrigin = (origin: string | null) => {
  if (!origin) return "https://admin.borderpayafrica.com";
  if (ADMIN_ORIGINS.has(origin) || /^https:\/\/borderpay-admin-panel-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return "https://admin.borderpayafrica.com";
};
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
});
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(req), "Content-Type": "application/json" },
});
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const normalizeEmail = (value: unknown) => clean(value, 254).toLowerCase();
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const sha256 = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const ROLE_MAP: Record<string, string> = {
  admin: "ADMIN_FINOPS",
  admin_finops: "ADMIN_FINOPS",
  support: "SUPPORT_AGENT",
  support_agent: "SUPPORT_AGENT",
  super_admin: "ADMIN_SUPER",
  admin_super: "ADMIN_SUPER",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const origin = req.headers.get("origin");
  if (origin && allowedOrigin(origin) !== origin) return json(req, { success: false, error: "Origin not allowed" }, 403);
  if (req.method !== "POST") return json(req, { success: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json(req, { success: false, error: "Server configuration missing" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { success: false, error: "Invalid JSON" }, 400); }
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const name = clean(body.name, 120) || email.split("@")[0];
  if (!validEmail(email) || password.length < 8) {
    return json(req, { success: false, error: "A valid email and password of at least 8 characters are required" }, 400);
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data: authData } = token ? await db.auth.getUser(token) : { data: { user: null } };
  let authorizedBy: string | null = null;
  let role = ROLE_MAP[clean(body.role, 40).toLowerCase()] || "ADMIN_FINOPS";
  let bootstrapKey: { id: unknown; uses: number } | null = null;

  if (authData.user) {
    const { data: caller, error: callerError } = await db.from("admin_users")
      .select("user_id,role").eq("user_id", authData.user.id).maybeSingle();
    if (callerError) return json(req, { success: false, error: "Admin authorization could not be verified" }, 500);
    const callerRole = clean(caller?.role, 80).toUpperCase();
    if (!caller || !["ADMIN_SUPER", "SUPER_ADMIN"].includes(callerRole)) {
      return json(req, { success: false, error: "Super admin access required" }, 403);
    }
    authorizedBy = authData.user.id;
  } else {
    // The shared secret is a first-admin bootstrap mechanism only. Once an
    // admin exists, all staff creation must be authorized by a signed-in
    // super admin so changing an environment secret cannot bypass RBAC.
    const { count, error: countError } = await db.from("admin_users")
      .select("user_id", { count: "exact", head: true });
    if (countError) return json(req, { success: false, error: "Admin authorization could not be verified" }, 500);
    if ((count || 0) > 0) return json(req, { success: false, error: "Sign in as a super admin to create staff accounts" }, 401);
    const adminSecret = String(body.admin_secret ?? "");
    if (!adminSecret) return json(req, { success: false, error: "Bootstrap secret required" }, 401);
    const { data: keyRow } = await db.from("admin_secret_keys")
      .select("id,uses,max_uses").eq("key_hash", await sha256(adminSecret)).eq("active", true).maybeSingle();
    if (!keyRow || (keyRow.max_uses !== null && keyRow.uses >= keyRow.max_uses)) {
      return json(req, { success: false, error: "Invalid or exhausted bootstrap secret" }, 401);
    }
    bootstrapKey = { id: keyRow.id, uses: Number(keyRow.uses || 0) };
    role = "ADMIN_SUPER";
  }

  const { data: existingAdmin, error: existingError } = await db.from("admin_users")
    .select("user_id").ilike("email", email).maybeSingle();
  if (existingError) return json(req, { success: false, error: "Admin account lookup failed" }, 500);
  if (existingAdmin) return json(req, { success: false, error: "An admin with this email already exists" }, 409);

  const { data: userData, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, is_admin: true, full_name: name },
  });
  if (createError || !userData.user) return json(req, { success: false, error: createError?.message || "Admin Auth user creation failed" }, 400);

  const { error: insertError } = await db.from("admin_users").insert({
    user_id: userData.user.id,
    email,
    role,
  });
  if (insertError) {
    await db.auth.admin.deleteUser(userData.user.id);
    return json(req, { success: false, error: insertError.message }, 500);
  }
  if (bootstrapKey) {
    await db.from("admin_secret_keys").update({ uses: bootstrapKey.uses + 1 }).eq("id", bootstrapKey.id);
  }
  console.info("admin_staff_created", { actor_id: authorizedBy, created_user_id: userData.user.id, role, bootstrap: !authorizedBy });
  return json(req, {
    success: true,
    message: "Admin account created",
    user_id: userData.user.id,
    role,
  }, 201);
});
