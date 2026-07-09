// business-team-invite — invite an email to the caller's business team.
//
// POST body:
//   { email: string, role?: 'admin' | 'member' | 'viewer' }
//
// Authorization:
//   • Caller must be owner OR admin on the business. Members/viewers cannot
//     invite. Anyone else: 403.
//
// Seat enforcement:
//   • Business accounts have a fixed 10-seat cap.
//   • Counts currently-occupied seats via count_active_team_seats RPC.
//   • If adding one more would exceed the cap, returns 402 'seat_limit_reached'.
//
// Idempotency:
//   • UNIQUE (business_user_id, invited_email) is enforced by the schema.
//     A repeat invite for the same email returns the existing row with
//     `reused: true` rather than 409.
//
// What we do NOT do here:
//   • No email-send. The email side will be wired in a follow-up (template
//     `business.team_invite`); for now the response includes the invite_id
//     so the client/ops can surface the invite manually.

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

const PLAN_MAX_SEATS: Record<string, number | null> = {
  // Flat business team-seat default (no Growth/Enterprise tiers).
  business_starter:    10,
  business_activated:  10,
};

const VALID_ROLES = new Set(["admin", "member", "viewer"]);

function normaliseEmail(e: string): string { return e.trim().toLowerCase(); }
function looksLikeEmail(e: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { email?: string; role?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const email = normaliseEmail(String(body.email || ""));
  const role  = String(body.role || "member").toLowerCase();
  if (!email || !looksLikeEmail(email)) return json({ success: false, error: "Valid email required" }, 400);
  if (!VALID_ROLES.has(role))           return json({ success: false, error: `role must be one of admin|member|viewer (got ${role})` }, 400);

  // Resolve caller's business + role
  let businessUserId: string | null = null;
  let callerRole: string | null = null;

  const { data: bizAsOwner } = await supa
    .from("business_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (bizAsOwner) {
    businessUserId = bizAsOwner.user_id;
    callerRole = "owner";
  } else {
    const { data: membership } = await supa
      .from("business_team_members")
      .select("business_user_id, role")
      .eq("member_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membership) {
      businessUserId = membership.business_user_id;
      callerRole = membership.role;
    }
  }
  if (!businessUserId || !callerRole) {
    return json({ success: false, error: "Not part of any business team", code: "no_business" }, 404);
  }
  if (callerRole !== "owner" && callerRole !== "admin") {
    return json({ success: false, error: "Only owners and admins can invite team members", code: "forbidden_role" }, 403);
  }

  // Plan + seat enforcement
  const { data: sub } = await supa
    .from("user_subscriptions")
    .select("plan_key, status")
    .eq("business_user_id", businessUserId)
    .in("status", ["active", "trialing"])
    .maybeSingle();
  const planKey = sub?.plan_key ?? "business_starter";
  const cap     = PLAN_MAX_SEATS[planKey];   // undefined for individual plans

  // Idempotent re-invite: existing row wins.
  const { data: existing } = await supa
    .from("business_team_members")
    .select("id, member_user_id, invited_email, role, status, invited_at, joined_at")
    .eq("business_user_id", businessUserId)
    .eq("invited_email", email)
    .maybeSingle();
  if (existing && existing.status !== "removed") {
    return json({ success: true, data: { ...existing, reused: true } });
  }

  // Seat-cap check (count BEFORE insert)
  if (typeof cap === "number") {
    const { data: used } = await supa.rpc("count_active_team_seats", { p_business_user_id: businessUserId });
    const usedN = typeof used === "number" ? used : 0;
    if (usedN >= cap) {
      return json({
        success:           false,
        code:              "seat_limit_reached",
        error:             `Your business includes ${cap} team seats, which are all in use.`,
        current_plan:      planKey,
        seats_used:        usedN,
        seats_cap:         cap,
      }, 402);
    }
  }

  // Insert the seat (or revive a previously-removed one).
  const nowIso = new Date().toISOString();
  const upsertPayload: any = {
    business_user_id: businessUserId,
    invited_email:    email,
    role,
    status:           "invited",
    invited_at:       nowIso,
    invited_by:       user.id,
  };
  const { data: row, error: insErr } = await supa
    .from("business_team_members")
    .upsert(upsertPayload, { onConflict: "business_user_id,invited_email" })
    .select("id, member_user_id, invited_email, role, status, invited_at, joined_at")
    .single();
  if (insErr || !row) {
    return json({ success: false, error: insErr?.message || "Insert failed" }, 500);
  }

  // TODO: send-email template 'business.team_invite' once template is created.
  return json({ success: true, data: row });
});
