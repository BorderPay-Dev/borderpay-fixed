import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const page = (body: string, status = 200) => new Response(body, {
  status,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors https://app.borderpayafrica.com capacitor: http://localhost https://localhost",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  },
});

Deno.serve(async (req) => {
  if (req.method !== "GET") return page("Method not allowed", 405);
  const token = new URL(req.url).searchParams.get("token")?.trim() || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page("Verification link is invalid.", 400);

  const { data, error } = await supabase
    .from("verification_launch_tokens")
    .select("target_url,expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data || Date.parse(data.expires_at) <= Date.now()) {
    return page("Verification link has expired. Return to BorderPay and tap Continue verification again.", 410);
  }

  let target: URL;
  try { target = new URL(data.target_url); } catch { return page("Verification link is invalid.", 400); }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== "https:" || (host !== "bridge.withpersona.com" && !host.endsWith(".withpersona.com"))) {
    return page("Verification destination is not permitted.", 400);
  }
  const href = escapeHtml(target.toString());
  return page(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Continue verification</title><style>html,body{height:100%;margin:0;background:#0b0e11;color:#fff;font-family:Inter,system-ui,sans-serif}main{min-height:100%;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));box-sizing:border-box}.card{width:min(420px,100%);border:1px solid #2a2f35;border-radius:24px;background:#15191e;padding:28px;box-sizing:border-box;text-align:center}h1{font-size:22px;margin:0 0 10px}p{color:#aab1ba;font-size:14px;line-height:1.5;margin:0 0 22px}a{display:block;border-radius:999px;background:#c7ff00;color:#050505;padding:14px 18px;font-weight:750;text-decoration:none}</style></head><body><main><section class="card"><h1>Secure business verification</h1><p>Open the secure verification form in your browser. Return to BorderPay when finished.</p><a href="${href}" target="_blank" rel="noopener noreferrer">Open secure verification</a></section></main></body></html>`);
});
