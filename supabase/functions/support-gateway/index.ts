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
  | "admin_ai_draft"
  | "admin_assign_ticket"
  | "admin_handoff_to_human"
  | "admin_update_status";

const STATUSES = new Set(["open", "pending_support", "pending_user", "resolved", "closed"]);
const ISSUE_TYPES = new Set(["account_access", "verification", "wallet_balances", "send_receive", "general"]);

function trimText(v: unknown, max = 1000): string {
  return String(v || "").trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function generateSupportDraft(input: {
  ticketSubject: string;
  issueType: string;
  requesterEmail: string;
  conversation: Array<{ sender_type: string; body: string; created_at?: string }>;
  operatorGuidance?: string;
}): Promise<{ draft: string; provider: "azure_openai" | "openai"; model: string }> {
  const systemPrompt = [
    "You are BorderPay customer support assistant for a live fintech product.",
    "Write a concise, human reply to the customer.",
    "Do not expose internal systems, providers, stack traces, or implementation details.",
    "Do not promise money movement completion unless already confirmed in the conversation.",
    "If escalation is needed, clearly state support will follow up.",
    "Keep tone professional and calm.",
  ].join(" ");

  const convoLines = input.conversation
    .slice(-12)
    .map((m) => `[${m.sender_type}] ${String(m.body || "").trim()}`)
    .join("\n");

  const userPrompt = [
    `Ticket subject: ${input.ticketSubject}`,
    `Issue type: ${input.issueType}`,
    `Requester: ${input.requesterEmail}`,
    input.operatorGuidance ? `Operator guidance: ${input.operatorGuidance}` : "",
    "Recent conversation:",
    convoLines || "(no prior messages)",
    "",
    "Return only the final customer-facing reply text.",
  ].filter(Boolean).join("\n");

  const azureEndpoint = (Deno.env.get("AZURE_OPENAI_ENDPOINT") ?? "").trim();
  const azureKey = (Deno.env.get("AZURE_OPENAI_API_KEY") ?? "").trim();
  const azureDeployment = (Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ?? "").trim();
  const azureApiVersion = (Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2024-10-21").trim();

  if (azureEndpoint && azureKey && azureDeployment) {
    const base = azureEndpoint.replace(/\/+$/, "");
    const url = `${base}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureKey,
      },
      body: JSON.stringify({
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = typeof raw?.error?.message === "string" ? raw.error.message : `Azure OpenAI error (${res.status})`;
      throw new Error(errMsg);
    }
    const draft = String(raw?.choices?.[0]?.message?.content ?? "").trim();
    if (!draft) throw new Error("Azure OpenAI returned an empty draft");
    return { draft, provider: "azure_openai", model: azureDeployment };
  }

  const openaiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const openaiModel = (Deno.env.get("OPENAI_MODEL") ?? "gpt-4o").trim();
  if (openaiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = typeof raw?.error?.message === "string" ? raw.error.message : `OpenAI error (${res.status})`;
      throw new Error(errMsg);
    }
    const draft = String(raw?.choices?.[0]?.message?.content ?? "").trim();
    if (!draft) throw new Error("OpenAI returned an empty draft");
    return { draft, provider: "openai", model: openaiModel };
  }

  throw new Error("AI provider not configured");
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
    if (!email || !isValidEmail(email)) {
      return json({ success: false, error: "Valid email is required" }, 400);
    }
    if (!ISSUE_TYPES.has(issueType)) return json({ success: false, error: "Invalid issue type" }, 400);

    // Lightweight anti-spam throttle for website widget:
    // cap to 3 tickets per email in the trailing 2-minute window.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentRows, error: recentErr } = await supa
      .from("support_tickets")
      .select("id")
      .eq("source", "website")
      .eq("requester_email", email)
      .gte("created_at", twoMinutesAgo)
      .limit(4);
    if (recentErr) return json({ success: false, error: recentErr.message }, 500);
    if ((recentRows || []).length >= 3) {
      return json(
        { success: false, error: "Too many requests. Please wait a few minutes and try again." },
        429,
      );
    }

    const context = typeof body?.context === "object" && body?.context
      ? body.context
      : {};
    const pageUrl = trimText(context?.page_url, 500);
    const referrer = trimText(context?.referrer, 500);
    const userAgent = trimText(context?.user_agent, 400);

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
      payload: {
        issue_type: issueType,
        email,
        page_url: pageUrl || null,
        referrer: referrer || null,
        user_agent: userAgent || null,
      },
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

  if (action === "admin_ai_draft") {
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);
    const ticketId = trimText(body?.ticket_id, 80);
    const operatorGuidance = trimText(body?.operator_guidance, 800);
    if (!ticketId) return json({ success: false, error: "ticket_id is required" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .select("id, requester_email, issue_type, subject")
      .eq("id", ticketId)
      .maybeSingle();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);
    if (!ticket) return json({ success: false, error: "Ticket not found" }, 404);

    const { data: messages, error: msgErr } = await supa
      .from("support_ticket_messages")
      .select("sender_type, body, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true })
      .limit(50);
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    try {
      const out = await generateSupportDraft({
        ticketSubject: String(ticket.subject ?? "Support request"),
        issueType: String(ticket.issue_type ?? "general"),
        requesterEmail: String(ticket.requester_email ?? "customer"),
        conversation: Array.isArray(messages) ? messages : [],
        operatorGuidance: operatorGuidance || undefined,
      });

      await supa.from("support_ticket_events").insert({
        ticket_id: ticketId,
        event_type: "ai_draft_generated",
        actor_user_id: user.id,
        payload: { provider: out.provider, model: out.model },
      });

      return json({
        success: true,
        data: {
          ticket_id: ticketId,
          draft: out.draft,
          provider: out.provider,
          model: out.model,
        },
      });
    } catch (e: any) {
      const message = String(e?.message || "Failed to generate AI draft");
      await supa.from("support_ticket_events").insert({
        ticket_id: ticketId,
        event_type: "ai_draft_failed",
        actor_user_id: user.id,
        payload: { reason: message.slice(0, 300) },
      });
      return json({ success: false, error: message }, 502);
    }
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

  if (action === "admin_assign_ticket") {
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);
    const ticketId = trimText(body?.ticket_id, 80);
    if (!ticketId) return json({ success: false, error: "ticket_id is required" }, 400);

    const { error } = await supa
      .from("support_tickets")
      .update({ assigned_admin_id: user.id })
      .eq("id", ticketId);
    if (error) return json({ success: false, error: error.message }, 500);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticketId,
      event_type: "ticket_assigned",
      actor_user_id: user.id,
      payload: { assigned_admin_id: user.id },
    });

    return json({ success: true, data: { ticket_id: ticketId, assigned_admin_id: user.id } });
  }

  if (action === "admin_handoff_to_human") {
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);
    const ticketId = trimText(body?.ticket_id, 80);
    const note = trimText(body?.note, 1000);
    if (!ticketId) return json({ success: false, error: "ticket_id is required" }, 400);

    const { error } = await supa
      .from("support_tickets")
      .update({ status: "pending_support", assigned_admin_id: user.id })
      .eq("id", ticketId);
    if (error) return json({ success: false, error: error.message }, 500);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticketId,
      event_type: "handoff_to_human",
      actor_user_id: user.id,
      payload: {
        note: note || null,
      },
    });

    return json({ success: true, data: { ticket_id: ticketId, status: "pending_support" } });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});
