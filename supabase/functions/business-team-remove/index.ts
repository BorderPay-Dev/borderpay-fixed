// business-team-remove — soft-remove a team-member seat.
//
// POST body: { member_id: string }   (the business_team_members.id)
//
// Authorization: only the business owner OR an admin can remove. Admins
// cannot remove the owner; owners cannot remove themselves (transfer
// ownership is a separate flow that doesn't exist yet).
//
// We don't hard-delete the row — `status = 'removed', removed_at = now()`
// keeps the audit history intact and prevents the unique (business_user_id,
// invited_email) constraint from blocking a future re-invite of the same
// email (we'll un-soft-delete on re-invite via upsert with status='invited').

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

  let body: { member_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const memberId = String(body.member_id || "").trim();
  if (!memberId) return json({ success: false, error: "member_id required" }, 400);

  // Look up the target row to validate cross-business + role guards.
  const { data: target } = await supa
    .from("business_team_members")
    .select("id, business_user_id, role, status, member_user_id, invited_email")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return json({ success: false, error: "Member not found" }, 404);
  if (target.status === "removed") return json({ success: true, data: { id: memberId, already_removed: true } });

  // Resolve caller's role in THIS business.
  let callerRole: string | null = null;
  const { data: bizAsOwner } = await supa
    .from("business_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (bizAsOwner && bizAsOwner.user_id === target.business_user_id) {
    callerRole = "owner";
  } else {
    const { data: membership } = await supa
      .from("business_team_members")
      .select("role, status")
      .eq("business_user_id", target.business_user_id)
      .eq("member_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membership) callerRole = membership.role;
  }
  if (!callerRole) return json({ success: false, error: "Forbidden", code: "forbidden" }, 403);
  if (callerRole !== "owner" && callerRole !== "admin") {
    return json({ success: false, error: "Only owners and admins can remove team members", code: "forbidden_role" }, 403);
  }
  if (target.role === "owner") {
    return json({ success: false, error: "The owner seat cannot be removed", code: "cannot_remove_owner" }, 400);
  }
  if (callerRole === "admin" && target.role === "admin") {
    // Optional rule: admins shouldn't remove other admins; owner only.
    return json({ success: false, error: "Only the owner can remove an admin", code: "forbidden_role" }, 403);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await supa
    .from("business_team_members")
    .update({ status: "removed", removed_at: nowIso, updated_at: nowIso })
    .eq("id", memberId)
    .select("id, business_user_id, invited_email, role, status, removed_at")
    .single();
  if (updErr || !updated) {
    return json({ success: false, error: updErr?.message || "Update failed" }, 500);
  }

  return json({ success: true, data: updated });
});
