import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SEND_EMAIL_INTERNAL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";

const ALLOWLIST = new Set([
  "bularnoikaba@gmail.com",
  "markikaba@outlook.com",
  "founders@borderpayafrica.com",
  "infos@borderpayafrica.com",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type Mode = "individual" | "business";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  if (!SUPABASE_URL || !SEND_EMAIL_INTERNAL_TOKEN) {
    return json({ success: false, error: "Missing SUPABASE_URL or SEND_EMAIL_INTERNAL_TOKEN" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const to = String(body.to || "bularnoikaba@gmail.com").trim().toLowerCase();
  if (!ALLOWLIST.has(to)) {
    return json({ success: false, error: "Recipient not allowed for test sender." }, 403);
  }

  const modeRaw = String(body.mode || "individual").trim().toLowerCase();
  const mode: Mode = modeRaw === "business" ? "business" : "individual";
  const template = mode === "business" ? "business.founder_welcome" : "individual.founder_welcome";

  const props = mode === "business"
    ? {
        full_name: String(body.full_name || "BorderPay User"),
        company_name: String(body.company_name || "BorderPay Business"),
      }
    : {
        full_name: String(body.full_name || "BorderPay User"),
      };

  const idempotency_key = `ops:founder_welcome_test:${mode}:${to}:${Date.now()}`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SEND_EMAIL_INTERNAL_TOKEN}`,
    },
    body: JSON.stringify({
      template,
      to,
      props,
      idempotency_key,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json(
      {
        success: false,
        mode,
        template,
        to,
        status: res.status,
        response: payload,
      },
      502,
    );
  }

  return json({
    success: true,
    mode,
    template,
    to,
    status: res.status,
    response: payload,
  });
});

