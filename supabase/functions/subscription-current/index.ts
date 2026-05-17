// subscription-current — return the caller's active subscription row and a
// recent-invoices list. Read-only.
//
// POST (no body). Response:
//   {
//     success: true,
//     data: {
//       subscription: {
//         id, plan_key, status,
//         current_period_start, current_period_end, cancel_at_period_end
//       } | null,
//       recent_invoices: Array<{
//         id, plan_key, amount_usd_cents, status, paid_at, created_at
//       }>
//     }
//   }
//
// Auth: standard supabase.auth.getUser(token). RLS protects rows, but we
// also branch on account_type so business accounts get the
// business_user_id row and individuals get the user_id row.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: profile } = await supa
    .from("user_profiles")
    .select("account_type")
    .eq("id", user.id)
    .maybeSingle();
  const isBusiness = profile?.account_type === "business";

  const subQuery = supa
    .from("user_subscriptions")
    .select("id, plan_key, status, current_period_start, current_period_end, cancel_at_period_end")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: sub } = isBusiness
    ? await subQuery.eq("business_user_id", user.id)
    : await subQuery.eq("user_id", user.id);

  // Recent invoices for this subscription, if any.
  let invoices: any[] = [];
  if (sub?.id) {
    const { data: invs } = await supa
      .from("subscription_invoices")
      .select("id, plan_key, amount_usd_cents, status, paid_at, created_at")
      .eq("subscription_id", sub.id)
      .order("created_at", { ascending: false })
      .limit(12);
    invoices = invs ?? [];
  }

  return json({
    success: true,
    data: {
      subscription:    sub ?? null,
      recent_invoices: invoices,
    },
  });
});
