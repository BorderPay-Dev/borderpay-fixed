// authorize-verification — admin authorizes a (paid) user's verification (#4).
//
// This is the manual-review authorization event. It:
//   1. authenticates the caller (must be an admin — enforced again in the RPC),
//   2. flips the target user's user_profiles.verification_review_status to
//      'authorized' via the authorize_verification(p_user_id, p_actor) RPC,
//   3. best-effort sends the "finish your document uploads" prompt email via the
//      logged send-email path (never direct Resend; recipient from the RPC
//      result, never from request input).
//
// Only AFTER this event do bridge-customer / bridge-kyc-link / bridge-kyb-link
// allow a billable Bridge call (and only for paid plans). SOURCE-ONLY; not yet
// deployed. The authorize_verification RPC ships with the (unapplied) migration
// 20260606120000_stepped_verification_gate.sql.
//
// POST body: { user_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_EMAIL_INTERNAL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Fire the prompt email through the logged send-email function. Best-effort:
 *  failures never fail the authorization. Recipient comes from the RPC result
 *  (DB), never from request input. */
async function sendAuthorizedEmail(row: { user_id: string; email: string | null; account_type: string | null }) {
  if (!row.email || !SEND_EMAIL_INTERNAL_TOKEN) return;
  const template = row.account_type === "business"
    ? "business.verification_authorized"
    : "individual.verification_authorized";
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        to:              row.email,
        template,
        props:           {},
        idempotency_key: `verif_authorized:${row.user_id}`,
      }),
    });
  } catch { /* best-effort: never block authorization on email */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const actor = userInfo?.user;
  if (authErr || !actor) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { user_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const targetId = String(body.user_id || "").trim();
  if (!targetId) return json({ success: false, error: "user_id required" }, 400);

  // RPC double-checks the actor is an admin (ERRCODE 42501 → not_authorized).
  const { data, error } = await supa.rpc("authorize_verification", {
    p_user_id: targetId,
    p_actor:   actor.id,
  });
  if (error) {
    const forbidden = String(error.message || "").includes("not_authorized") || error.code === "42501";
    return json({ success: false, error: forbidden ? "Not authorized" : error.message }, forbidden ? 403 : 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ success: false, error: "User not found" }, 404);

  await sendAuthorizedEmail(row);

  return json({ success: true, data: { user_id: row.user_id, verification_review_status: "authorized" } });
});
