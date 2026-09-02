import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROD_ORIGIN = "https://partners.borderpayafrica.com";
const allowedOrigin = (origin: string | null) => {
  if (!origin) return PROD_ORIGIN;
  if (origin === PROD_ORIGIN || origin === "https://borderpay-partners.vercel.app" || origin === "http://localhost:5173") return origin;
  if (/^https:\/\/borderpay-partners-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return PROD_ORIGIN;
};
const headers = (req: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Cache-Control": "no-store",
});
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers(req), "Content-Type": "application/json" },
});

const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const countryOk = (value: unknown) => /^[A-Z]{2}$/.test(clean(value).toUpperCase());
const editable = new Set(["draft", "more_information"]);

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function completeness(app: any, people: any[], documents: any[]) {
  const entity = app?.entity_details || {};
  const operating = app?.operating_details || {};
  const compliance = app?.compliance_details || {};
  const technical = app?.technical_details || {};
  const declarations = app?.declarations || {};
  const missing: string[] = [];
  const required: Array<[unknown, string]> = [
    [entity.legal_name, "Legal business name"],
    [entity.registration_number, "Registration number"],
    [countryOk(entity.country_of_incorporation), "Country of incorporation"],
    [entity.registered_address, "Registered address"],
    [entity.operating_address, "Operating address"],
    [operating.business_model, "Business model"],
    [operating.intended_use, "Intended BorderPay use"],
    [Array.isArray(operating.corridors) && operating.corridors.length > 0, "Operating corridors"],
    [Number(operating.expected_monthly_volume_usd) > 0, "Expected monthly volume"],
    [Number(operating.expected_monthly_transactions) > 0, "Expected monthly transactions"],
    [Number(operating.maximum_transfer_usd) > 0, "Maximum transfer size"],
    [compliance.aml_program_confirmed === true, "AML program confirmation"],
    [compliance.sanctions_screening_confirmed === true, "Sanctions screening confirmation"],
    [compliance.pep_screening_confirmed === true, "PEP screening confirmation"],
    [compliance.adverse_media_confirmed === true, "Adverse-media screening confirmation"],
    [typeof compliance.regulated === "boolean", "Regulatory status"],
    [typeof compliance.nda_available === "boolean", "NDA status"],
    [technical.technical_contact_email && emailOk(technical.technical_contact_email), "Technical contact"],
    [technical.compliance_contact_email && emailOk(technical.compliance_contact_email), "Compliance contact"],
    [technical.security_contact_email && emailOk(technical.security_contact_email), "Security contact"],
    [Array.isArray(technical.static_egress_ips) && technical.static_egress_ips.length > 0, "Static egress IP"],
    [declarations.accuracy === true, "Accuracy declaration"],
    [declarations.authority === true, "Authority declaration"],
    [declarations.privacy === true, "Privacy declaration"],
  ];
  for (const [value, label] of required) if (!value) missing.push(label);
  if (!Array.isArray(app?.requested_products) || app.requested_products.length === 0) missing.push("Requested product");
  if (!people.some((person) => person.person_type === "director")) missing.push("At least one director");
  if (!people.some((person) => person.person_type === "controller")) missing.push("At least one controller");
  if (!people.some((person) => person.person_type === "ubo" && Number(person.ownership_percent) >= 20) && declarations.no_ubo_over_20 !== true) {
    missing.push("All UBOs owning 20% or more, or no-UBO declaration");
  }
  const docTypes = new Set(documents.map((doc) => doc.document_type));
  for (const [type, label] of [
    ["certificate_of_incorporation", "Certificate of incorporation"],
    ["register_of_directors", "Register of directors"],
    ["register_of_shareholders", "Register of shareholders"],
  ]) if (!docTypes.has(type)) missing.push(label);
  return missing;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { success: false, error: "POST only" }, 405);
  if (req.headers.get("origin") && allowedOrigin(req.headers.get("origin")) !== req.headers.get("origin")) {
    return json(req, { success: false, error: "Origin not allowed" }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json(req, { success: false, error: "Server configuration missing" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: any;
  try { body = await req.json(); } catch { return json(req, { success: false, error: "Invalid JSON" }, 400); }
  const action = clean(body?.action, 60);

  try {
    if (action === "request_invite") {
      const email = clean(body?.email, 254).toLowerCase();
      if (!emailOk(email)) return json(req, { success: false, error: "Valid business email required" }, 400);
      const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
      const ipHash = await sha256(`${Deno.env.get("PARTNER_INVITE_HASH_SALT") || serviceKey}:${ip}`);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await db.from("partner_access_invite_requests").select("id", { head: true, count: "exact" }).eq("email", email).gte("requested_at", since);
      if ((count || 0) < 3) {
        await db.from("partner_access_invite_requests").insert({ email, requester_ip_hash: ipHash });
        await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${PROD_ORIGIN}/auth/callback?setup=password` });
      }
      return json(req, { success: true, message: "If eligible, an access email will arrive shortly." });
    }

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user) return json(req, { success: false, error: "Authentication required" }, 401);
    const user = authData.user;

    let { data: org } = await db.from("partner_organizations").select("*").eq("owner_user_id", user.id).maybeSingle();
    if (!org) {
      const { data: created, error } = await db.from("partner_organizations").insert({ owner_user_id: user.id, primary_email: user.email || "" }).select("*").single();
      if (error) throw error;
      org = created;
      await db.from("partner_members").insert({ organization_id: org.id, user_id: user.id, role: "owner" });
    }
    const { data: member } = await db.from("partner_members").select("role,is_active").eq("organization_id", org.id).eq("user_id", user.id).maybeSingle();
    if (!member?.is_active) return json(req, { success: false, error: "Partner access disabled" }, 403);
    let { data: app } = await db.from("partner_applications").select("*").eq("organization_id", org.id).in("status", ["draft", "submitted", "under_review", "more_information"]).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!app && org.status !== "approved") {
      const { data: created, error } = await db.from("partner_applications").insert({ organization_id: org.id }).select("*").single();
      if (error) throw error;
      app = created;
    }

    if (action === "get_state") {
      const [{ data: people }, { data: documents }] = await Promise.all([
        app ? db.from("partner_controlling_people").select("*").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [] }),
        app ? db.from("partner_application_documents").select("id,document_type,original_filename,mime_type,size_bytes,created_at").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [] }),
      ]);
      return json(req, { success: true, organization: org, application: app, people: people || [], documents: documents || [] });
    }
    if (!app) return json(req, { success: false, error: "No active application" }, 409);
    if (!editable.has(app.status)) return json(req, { success: false, error: "Application is read-only during review" }, 409);

    if (action === "save_application") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of ["entity_details", "operating_details", "compliance_details", "technical_details", "declarations"]) {
        if (body[key] && typeof body[key] === "object" && !Array.isArray(body[key])) patch[key] = body[key];
      }
      if (Array.isArray(body.requested_products)) patch.requested_products = body.requested_products.filter((v: unknown) => v === "api" || v === "white_label");
      const entity: any = patch.entity_details;
      if (entity) {
        if (entity.country_of_incorporation && !countryOk(entity.country_of_incorporation)) return json(req, { success: false, error: "Country must be ISO-2" }, 400);
        await db.from("partner_organizations").update({ legal_name: clean(entity.legal_name, 200) || null, trading_name: clean(entity.trading_name, 200) || null, website: clean(entity.website, 500) || null, country_of_incorporation: clean(entity.country_of_incorporation, 2).toUpperCase() || null, registration_number: clean(entity.registration_number, 120) || null, updated_at: new Date().toISOString() }).eq("id", org.id);
      }
      const { data, error } = await db.from("partner_applications").update(patch).eq("id", app.id).select("*").single();
      if (error) throw error;
      return json(req, { success: true, application: data });
    }
    if (action === "upsert_person") {
      const payload = {
        application_id: app.id,
        person_type: clean(body.person_type, 20), full_name: clean(body.full_name, 200), date_of_birth: clean(body.date_of_birth, 10),
        nationality: clean(body.nationality, 2).toUpperCase(), country_of_residence: clean(body.country_of_residence, 2).toUpperCase(),
        residential_address: clean(body.residential_address, 1000), ownership_percent: body.person_type === "ubo" ? Number(body.ownership_percent) : null,
        is_politically_exposed: body.is_politically_exposed === true, updated_at: new Date().toISOString(),
      };
      if (!payload.full_name || !countryOk(payload.nationality) || !countryOk(payload.country_of_residence) || !payload.residential_address) return json(req, { success: false, error: "Complete person details required" }, 400);
      const id = clean(body.id, 40);
      const query = id ? db.from("partner_controlling_people").update(payload).eq("id", id).eq("application_id", app.id) : db.from("partner_controlling_people").insert(payload);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return json(req, { success: true, person: data });
    }
    if (action === "delete_person") {
      const { error } = await db.from("partner_controlling_people").delete().eq("id", clean(body.id, 40)).eq("application_id", app.id);
      if (error) throw error;
      return json(req, { success: true });
    }
    if (action === "create_document_upload") {
      const type = clean(body.document_type, 80);
      const mime = clean(body.mime_type, 80);
      const size = Number(body.size_bytes);
      if (!/^[a-z_]+$/.test(type) || !["application/pdf", "image/jpeg", "image/png"].includes(mime) || !(size > 0 && size <= 10485760)) return json(req, { success: false, error: "PDF, JPG, or PNG up to 10 MB required" }, 400);
      const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
      const path = `${org.id}/${app.id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from("partner-due-diligence").createSignedUploadUrl(path);
      if (error) throw error;
      return json(req, { success: true, path, token: data.token, signed_url: data.signedUrl });
    }
    if (action === "finalize_document") {
      const path = clean(body.storage_path, 500);
      if (!path.startsWith(`${org.id}/${app.id}/`)) return json(req, { success: false, error: "Invalid document path" }, 400);
      const payload = { application_id: app.id, document_type: clean(body.document_type, 80), storage_path: path, original_filename: clean(body.original_filename, 240), mime_type: clean(body.mime_type, 80), size_bytes: Number(body.size_bytes), uploaded_by: user.id };
      const { data, error } = await db.from("partner_application_documents").insert(payload).select("id,document_type,original_filename,mime_type,size_bytes,created_at").single();
      if (error) throw error;
      return json(req, { success: true, document: data });
    }
    if (action === "submit_application") {
      const [{ data: people }, { data: documents }] = await Promise.all([
        db.from("partner_controlling_people").select("*").eq("application_id", app.id),
        db.from("partner_application_documents").select("*").eq("application_id", app.id),
      ]);
      const missing = completeness(app, people || [], documents || []);
      if (missing.length) return json(req, { success: false, error: "Application incomplete", missing }, 422);
      const now = new Date().toISOString();
      const { error } = await db.from("partner_applications").update({ status: "submitted", submitted_at: now, updated_at: now }).eq("id", app.id);
      if (error) throw error;
      await db.from("partner_organizations").update({ status: "submitted", updated_at: now }).eq("id", org.id);
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, application_id: app.id, actor_user_id: user.id, event_type: "application_submitted" });
      return json(req, { success: true, status: "submitted" });
    }
    return json(req, { success: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("partner-onboarding", error);
    return json(req, { success: false, error: "Partner request failed" }, 500);
  }
});
