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
//   • Reads the business's active plan_key from user_subscriptions.
//     business_starter   →  10 seats (view-only until activated).
//     business_activated →  10 seats.
//   • Counts currently-occupied seats via count_active_team_seats RPC. If
//     adding one more would exceed the cap → 402 'seat_limit_reached'
//     + upgrade_to: 'business_activated'; activated-at-cap → 402
//     'seat_limit_reached' (no higher tier).
//
// Idempotency:
//   • UNIQUE (business_user_id, invited_email) is enforced by the schema.
//     A repeat invite for the same email returns the existing row with
//     `reused: true` rather than 409.
//
// Email:
//   • Sends `business.team_invite` through the logged send-email function.
//   • Invite tokens are random, single-purpose, and stored only as SHA-256 hash.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN      = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL               = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";
const INVITE_TTL_DAYS       = 7;

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
function base64Url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function newInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendInviteEmail(args: {
  to: string;
  rowId: string;
  companyName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  idempotencyKey: string;
}) {
  const bearer = SEND_EMAIL_TOKEN || SUPABASE_SERVICE_ROLE;
  if (!bearer) return { ok: false, error: "SEND_EMAIL_INTERNAL_TOKEN missing" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        template: "business.team_invite",
        to: args.to,
        idempotency_key: args.idempotencyKey,
        props: {
          company_name: args.companyName,
          inviter_name: args.inviterName,
          role: args.role,
          invite_url: args.inviteUrl,
          expires_in_days: INVITE_TTL_DAYS,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data as any)?.success) {
      return { ok: false, error: (data as any)?.error || `send-email HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const authToken = auth.replace(/^Bearer\s+/i, "").trim();
  if (!authToken) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(authToken);
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

  const { data: businessProfile } = await supa
    .from("business_profiles")
    .select("company_name")
    .eq("user_id", businessUserId)
    .maybeSingle();
  const companyName = String((businessProfile as any)?.company_name || "your business").trim();

  const { data: inviterProfile } = await supa
    .from("user_profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  const inviterName = String((inviterProfile as any)?.full_name || user.email || "A BorderPay business admin").trim();

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
    if (existing.status !== "invited") {
      return json({ success: true, data: { ...existing, reused: true, email_sent: false } });
    }
    const token = newInviteToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: refreshed, error: refreshErr } = await supa
      .from("business_team_members")
      .update({
        role,
        invited_at: isoNow(),
        invited_by: user.id,
        invite_token_hash: tokenHash,
        invite_expires_at: expiresAt,
      })
      .eq("id", existing.id)
      .select("id, member_user_id, invited_email, role, status, invited_at, joined_at")
      .single();
    if (refreshErr || !refreshed) {
      return json({ success: false, error: refreshErr?.message || "Invite refresh failed" }, 500);
    }
    const inviteUrl = `${APP_URL}/team/invite?token=${encodeURIComponent(token)}`;
    const sent = await sendInviteEmail({
      to: email,
      rowId: refreshed.id,
      companyName,
      inviterName,
      role,
      inviteUrl,
      idempotencyKey: `business-team-invite:${refreshed.id}:${tokenHash.slice(0, 16)}`,
    });
    return json({
      success: true,
      data: {
        ...refreshed,
        reused: true,
        email_sent: sent.ok,
        ...(sent.ok ? {} : { email_error: sent.error }),
      },
    });
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
  const token = newInviteToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const upsertPayload: any = {
    business_user_id: businessUserId,
    invited_email:    email,
    role,
    status:           "invited",
    invited_at:       nowIso,
    invited_by:       user.id,
    invite_token_hash: tokenHash,
    invite_expires_at: expiresAt,
  };
  const { data: row, error: insErr } = await supa
    .from("business_team_members")
    .upsert(upsertPayload, { onConflict: "business_user_id,invited_email" })
    .select("id, member_user_id, invited_email, role, status, invited_at, joined_at")
    .single();
  if (insErr || !row) {
    return json({ success: false, error: insErr?.message || "Insert failed" }, 500);
  }

  const inviteUrl = `${APP_URL}/team/invite?token=${encodeURIComponent(token)}`;
  const sent = await sendInviteEmail({
    to: email,
    rowId: row.id,
    companyName,
    inviterName,
    role,
    inviteUrl,
    idempotencyKey: `business-team-invite:${row.id}:${tokenHash.slice(0, 16)}`,
  });

  return json({
    success: true,
    data: {
      ...row,
      email_sent: sent.ok,
      ...(sent.ok ? {} : { email_error: sent.error }),
    },
  });
});

function isoNow(): string {
  return new Date().toISOString();
}
