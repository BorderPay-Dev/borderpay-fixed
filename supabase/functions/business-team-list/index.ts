// business-team-list — list all team members for the caller's business.
//
// Authorization model:
//   • Caller must be either:
//       (a) the business owner (business_profiles.user_id == auth.uid), OR
//       (b) an active 'admin' on the business via business_team_members, OR
//       (c) an active 'member'/'viewer' on the business (read-only).
//   • Anyone else gets 403. RLS already prevents cross-business reads, but
//     we also resolve `business_user_id` server-side from the caller's
//     membership so the client doesn't supply it and risk enumeration.
//
// Response shape:
//   {
//     success: true,
//     data: {
//       business_user_id,
//       caller_role: 'owner' | 'admin' | 'member' | 'viewer',
//       plan: { plan_key, max_team_members: number | null },
//       seats: { used, cap: number | null },
//       members: Array<{
//         id, member_user_id, invited_email, role, status,
//         invited_at, joined_at, removed_at,
//       }>,
//     }
//   }
//
// Method: POST (empty body) for symmetry with other functions; GET also
// works to allow a plain fetch from the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Plan → seat-cap mirror of utils/subscriptions/plans.ts. Kept in sync
// manually; if you change one, change the other.
const PLAN_MAX_SEATS: Record<string, number | null> = {
  business_starter:    5,
  business_growth:     20,
  business_enterprise: null,    // unlimited
  // Individual plans never reach this surface.
  individual_starter:  null,
  individual_premium:  null,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ success: false, error: "POST or GET only" }, 405);
  }

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  // Resolve the business the caller belongs to. Owner first; otherwise look
  // up via business_team_members. We deliberately do not accept a
  // business_user_id from the client.
  let businessUserId: string | null = null;
  let callerRole: 'owner' | 'admin' | 'member' | 'viewer' | null = null;

  const { data: bizAsOwner } = await supa
    .from("business_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (bizAsOwner) {
    businessUserId = bizAsOwner.user_id;
    callerRole = 'owner';
  } else {
    const { data: membership } = await supa
      .from("business_team_members")
      .select("business_user_id, role, status")
      .eq("member_user_id", user.id)
      .in("status", ["active"])
      .maybeSingle();
    if (membership) {
      businessUserId = membership.business_user_id;
      callerRole = membership.role as any;
    }
  }
  if (!businessUserId || !callerRole) {
    return json({ success: false, error: "Not part of any business team", code: "no_business" }, 404);
  }

  // Plan + seat cap
  const { data: sub } = await supa
    .from("user_subscriptions")
    .select("plan_key, status")
    .eq("business_user_id", businessUserId)
    .in("status", ["active", "trialing"])
    .maybeSingle();
  const planKey = sub?.plan_key ?? "business_starter";
  const cap     = PLAN_MAX_SEATS[planKey] ?? null;

  // Members roster (exclude soft-deleted rows by default)
  const { data: members, error: membersErr } = await supa
    .from("business_team_members")
    .select("id, member_user_id, invited_email, role, status, invited_at, joined_at, removed_at")
    .eq("business_user_id", businessUserId)
    .in("status", ["invited", "active", "suspended"])
    .order("invited_at", { ascending: true });
  if (membersErr) {
    return json({ success: false, error: membersErr.message }, 500);
  }

  // `count_active_team_seats` is what plan enforcement uses; mirror it here.
  const { data: usedCount } = await supa.rpc("count_active_team_seats", {
    p_business_user_id: businessUserId,
  });
  const used = typeof usedCount === "number" ? usedCount : (members || []).filter(m => m.status === "active" || m.status === "invited").length;

  return json({
    success: true,
    data: {
      business_user_id: businessUserId,
      caller_role:      callerRole,
      plan:             { plan_key: planKey, max_team_members: cap },
      seats:            { used, cap },
      members:          members || [],
    },
  });
});
