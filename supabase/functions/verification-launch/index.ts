import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ALLOWED_ORIGINS = new Set([
  "https://app.borderpayafrica.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://app.borderpayafrica.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) });
  }
  if (req.method !== "GET") {
    return json(req, { success: false, error: "Method not allowed" }, 405);
  }

  const token = new URL(req.url).searchParams.get("token")?.trim() || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return json(
      req,
      { success: false, error: "Verification link is invalid." },
      400,
    );
  }

  const { data, error } = await supabase
    .from("verification_launch_tokens")
    .select("target_url,expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data || Date.parse(data.expires_at) <= Date.now()) {
    return json(req, {
      success: false,
      error:
        "Verification link has expired. Return to BorderPay and tap Continue verification again.",
    }, 410);
  }

  let target: URL;
  try {
    target = new URL(data.target_url);
  } catch {
    return json(
      req,
      { success: false, error: "Verification link is invalid." },
      400,
    );
  }
  const host = target.hostname.toLowerCase();
  if (
    target.protocol !== "https:" ||
    (host !== "bridge.withpersona.com" && !host.endsWith(".withpersona.com"))
  ) {
    return json(req, {
      success: false,
      error: "Verification destination is not permitted.",
    }, 400);
  }

  return json(req, {
    success: true,
    data: { target_url: target.toString(), expires_at: data.expires_at },
  });
});
