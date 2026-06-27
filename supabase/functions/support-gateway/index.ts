import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Action =
  | "create_ticket"
  | "public_create_ticket"
  | "list_tickets"
  | "get_ticket"
  | "add_message"
  | "admin_list_tickets"
  | "admin_reply"
  | "admin_update_status";

const STATUSES = new Set(["open", "pending_support", "pending_user", "resolved", "closed"]);
const ISSUE_TYPES = new Set(["account_access", "verification", "wallet_balances", "send_receive", "general"]);

function trimText(v: unknown, max = 1000): string {
  return String(v || "").trim().slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = String(body?.action || "").trim() as Action;
  if (!action) return json({ success: false, error: "action is required" }, 400);

  const isPublicCreate = action === "public_create_ticket";

  let user: any = null;
  let isAdmin = false;
  if (!isPublicCreate) {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "Authorization required" }, 401);
    const { data: authData, error: authErr } = await supa.auth.getUser(token);
    user = authData?.user;
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
    isAdmin = !!(await supa.rpc("is_borderpay_admin")).data;
  }

  const profile = user
    ? (await supa
      .from("user_profiles")
      .select("id, email, account_type, full_name")
      .eq("id", user.id)
      .maybeSingle()).data
    : null;

  if (action === "create_ticket") {
    const issueType = trimText(body?.issue_type, 64) || "general";
    const subject = trimText(body?.subject, 160);
    const message = trimText(body?.message, 4000);
    const source = trimText(body?.source, 32) || "app";
    if (!subject) return json({ success: false, error: "Subject is required" }, 400);
    if (!message) return json({ success: false, error: "Message is required" }, 400);
    if (!ISSUE_TYPES.has(issueType)) return json({ success: false, error: "Invalid issue type" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .insert({
        requester_user_id: user.id,
        requester_email: profile?.email || user.email || null,
        requester_account_type: String(profile?.account_type || "individual"),
        issue_type: issueType,
        source,
        subject,
        status: "open",
        priority: "normal",
      })
      .select("*")
      .single();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      sender_type: "user",
      sender_user_id: user.id,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      event_type: "ticket_created",
      actor_user_id: user.id,
      payload: { source, issue_type: issueType },
    });

    return json({ success: true, data: { ticket_id: ticket.id } });
  }

  if (action === "public_create_ticket") {
    const issueType = trimText(body?.issue_type, 64) || "general";
    const subject = trimText(body?.subject, 160);
    const message = trimText(body?.message, 4000);
    const email = trimText(body?.email, 200).toLowerCase();
    const name = trimText(body?.name, 160);
    if (!subject) return json({ success: false, error: "Subject is required" }, 400);
    if (!message) return json({ success: false, error: "Message is required" }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: "Valid email is required" }, 400);
    }
    if (!ISSUE_TYPES.has(issueType)) return json({ success: false, error: "Invalid issue type" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .insert({
        requester_user_id: null,
        requester_email: email,
        requester_name: name || null,
        requester_account_type: "individual",
        issue_type: issueType,
        source: "website",
        subject,
        status: "open",
        priority: "normal",
      })
      .select("*")
      .single();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      sender_type: "user",
      sender_user_id: null,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      event_type: "website_ticket_created",
      actor_user_id: null,
      payload: { issue_type: issueType, email },
    });

    return json({ success: true, data: { ticket_id: ticket.id } });
  }

  if (action === "list_tickets") {
    const limit = Math.min(Math.max(Number(body?.limit || 20), 1), 100);
    const { data: tickets, error } = await supa
      .from("support_tickets")
      .select("*")
      .eq("requester_user_id", user.id)
      .order("last_message_at", { ascending: false })
      .limit(limit);
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, data: { tickets: tickets || [] } });
  }

  if (action === "get_ticket") {
    const ticketId = trimText(body?.ticket_id, 80);
    if (!ticketId) return json({ success: false, error: "ticket_id is required" }, 400);

    let ticketQuery = supa.from("support_tickets").select("*").eq("id", ticketId).limit(1);
    if (!isAdmin) ticketQuery = ticketQuery.eq("requester_user_id", user.id);
    const { data: ticketRows, error: ticketErr } = await ticketQuery;
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);
    const ticket = (ticketRows || [])[0];
    if (!ticket) return json({ success: false, error: "Ticket not found" }, 404);

    const { data: messages, error: msgErr } = await supa
      .from("support_ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    return json({ success: true, data: { ticket, messages: messages || [] } });
  }

  if (action === "add_message") {
    const ticketId = trimText(body?.ticket_id, 80);
    const message = trimText(body?.message, 4000);
    if (!ticketId || !message) return json({ success: false, error: "ticket_id and message are required" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .select("id, requester_user_id, status")
      .eq("id", ticketId)
      .eq("requester_user_id", user.id)
      .maybeSingle();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);
    if (!ticket) return json({ success: false, error: "Ticket not found" }, 404);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticketId,
      sender_type: "user",
      sender_user_id: user.id,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    await supa
      .from("support_tickets")
      .update({ status: "pending_support" })
      .eq("id", ticketId)
      .eq("requester_user_id", user.id);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticketId,
      event_type: "user_message",
      actor_user_id: user.id,
      payload: {},
    });

    return json({ success: true, data: { ticket_id: ticketId } });
  }

  if (action === "admin_list_tickets") {
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);
    const limit = Math.min(Math.max(Number(body?.limit || 50), 1), 200);
    const status = trimText(body?.status, 40);
    let q = supa.from("support_tickets").select("*").order("last_message_at", { ascending: false }).limit(limit);
    if (status && STATUSES.has(status)) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, data: { tickets: data || [] } });
  }

  if (action === "admin_reply") {
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);
    const ticketId = trimText(body?.ticket_id, 80);
    const message = trimText(body?.message, 4000);
    if (!ticketId || !message) return json({ success: false, error: "ticket_id and message are required" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .select("id, first_response_at")
      .eq("id", ticketId)
      .maybeSingle();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);
    if (!ticket) return json({ success: false, error: "Ticket not found" }, 404);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticketId,
      sender_type: "agent",
      sender_user_id: user.id,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    const patch: Record<string, unknown> = { status: "pending_user", assigned_admin_id: user.id };
    if (!ticket.first_response_at) patch.first_response_at = new Date().toISOString();
    await supa.from("support_tickets").update(patch).eq("id", ticketId);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticketId,
      event_type: "agent_reply",
      actor_user_id: user.id,
      payload: {},
    });

    return json({ success: true, data: { ticket_id: ticketId } });
  }

  if (action === "admin_update_status") {
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);
    const ticketId = trimText(body?.ticket_id, 80);
    const status = trimText(body?.status, 40);
    if (!ticketId || !status) return json({ success: false, error: "ticket_id and status are required" }, 400);
    if (!STATUSES.has(status)) return json({ success: false, error: "Invalid status" }, 400);

    const patch: Record<string, unknown> = { status, assigned_admin_id: user.id };
    if (status === "resolved") patch.resolved_at = new Date().toISOString();
    if (status === "closed") patch.closed_at = new Date().toISOString();
    const { error } = await supa.from("support_tickets").update(patch).eq("id", ticketId);
    if (error) return json({ success: false, error: error.message }, 500);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticketId,
      event_type: "status_changed",
      actor_user_id: user.id,
      payload: { status },
    });

    return json({ success: true, data: { ticket_id: ticketId, status } });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});
