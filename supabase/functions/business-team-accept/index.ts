// business-team-accept — accept a business team invitation.
//
// POST body: { token: string }
//
// Security:
//   • Caller must be authenticated.
//   • Token is matched by SHA-256 hash only.
//   • The authenticated user's email must match invited_email.
//   • Expired, removed, or already-used-by-another-user invitations fail closed.

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

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normaliseEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return json({ success: false, error: "Authorization required" }, 401);

  const { data: userInfo, error: authErr } = await supa.auth.getUser(bearer);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { token?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const token = String(body.token || "").trim();
  if (!token || token.length < 20) {
    return json({ success: false, error: "Invite token required", code: "missing_token" }, 400);
  }

  const tokenHash = await sha256Hex(token);
  const { data: invite, error: inviteErr } = await supa
    .from("business_team_members")
    .select("id, business_user_id, member_user_id, invited_email, role, status, invite_expires_at, accepted_at, metadata")
    .eq("invite_token_hash", tokenHash)
    .maybeSingle();

  if (inviteErr) return json({ success: false, error: inviteErr.message }, 500);
  if (!invite) return json({ success: false, error: "Invite link is invalid", code: "not_found" }, 404);

  const invitedEmail = normaliseEmail(invite.invited_email);
  const userEmail = normaliseEmail(user.email);
  if (!userEmail || invitedEmail !== userEmail) {
    return json({
      success: false,
      code: "email_mismatch",
      error: "Sign in with the email address that received this invitation.",
    }, 403);
  }

  if (invite.status === "active" && invite.member_user_id === user.id) {
    const profile = await readBusinessProfile(invite.business_user_id);
    return json({
      success: true,
      data: {
        id: invite.id,
        business_user_id: invite.business_user_id,
        company_name: profile.company_name,
        role: invite.role,
        status: "active",
        already_accepted: true,
      },
    });
  }

  if (invite.status !== "invited") {
    return json({ success: false, error: "Invite is no longer active", code: "not_active" }, 400);
  }

  if (invite.invite_expires_at && Date.parse(invite.invite_expires_at) < Date.now()) {
    return json({ success: false, error: "Invite link expired. Ask the business admin to resend it.", code: "expired" }, 410);
  }

  const now = new Date().toISOString();
  const metadata = {
    ...((invite.metadata && typeof invite.metadata === "object") ? invite.metadata : {}),
    accepted_by: user.id,
    accepted_email: userEmail,
  };
  const { data: updated, error: updateErr } = await supa
    .from("business_team_members")
    .update({
      member_user_id: user.id,
      status: "active",
      joined_at: now,
      accepted_at: now,
      invite_token_hash: null,
      metadata,
      updated_at: now,
    })
    .eq("id", invite.id)
    .eq("status", "invited")
    .select("id, business_user_id, member_user_id, invited_email, role, status, joined_at")
    .single();

  if (updateErr || !updated) {
    return json({ success: false, error: updateErr?.message || "Could not accept invite" }, 500);
  }

  const profile = await readBusinessProfile(updated.business_user_id);
  return json({
    success: true,
    data: {
      ...updated,
      company_name: profile.company_name,
    },
  });
});

async function readBusinessProfile(businessUserId: string): Promise<{ company_name: string }> {
  const { data } = await supa
    .from("business_profiles")
    .select("company_name")
    .eq("user_id", businessUserId)
    .maybeSingle();
  return { company_name: String((data as any)?.company_name || "Business account").trim() };
}
