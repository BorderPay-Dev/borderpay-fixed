import {
  actionMessage,
  remindBusiness,
  reminderStage,
  safeLink,
} from "../supabase/functions/bridge-missing-customer-migration/reminders.ts";
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
Deno.test("reminders require actionable provider status and trusted HTTPS links", () => {
  for (
    const status of [
      "active",
      "approved",
      "under_review",
      "pending",
      "paused",
      "rejected",
      "offboarded",
      "",
    ]
  ) assert(reminderStage({ status }) === null, status);
  assert(
    reminderStage({ status: "awaiting_ubo" }) === "needs_ubos",
    "UBO mapping",
  );
  assert(
    reminderStage({ status: "incomplete" }) === "incomplete",
    "incomplete mapping",
  );
  assert(
    safeLink({ url: "https://bridge.withpersona.com/verify?token=synthetic" })
      .includes("synthetic"),
    "provider link preserved",
  );
  for (
    const url of [
      "https://bridge.xyz.attacker.invalid/link",
      "http://bridge.xyz/link",
      "javascript:alert(1)",
      "https://name:secret@bridge.xyz",
    ]
  ) {
    let failed = false;
    try {
      safeLink({ url });
    } catch {
      failed = true;
    }
    assert(failed, "unsafe link accepted");
  }
  assert(
    actionMessage("needs_ubos", false).includes("beneficial-owner"),
    "UBO message",
  );
  assert(
    actionMessage("not_started", true).includes("Terms of Service"),
    "ToS message",
  );
});
Deno.test("live-status checks, recent-email suppression, dry-run and link dispatch", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const profile = {
    id,
    email: "owner@example.invalid",
    account_type: "business",
    account_status: "pending_kyc",
    payment_provider: "bridge",
    bridge_customer_id: "synthetic-customer",
  };
  const business = {
    company_name: "Synthetic Ltd",
    country: "GB",
    bridge_customer_id: "synthetic-customer",
  };
  let recent = false,
    prior = false,
    sent = 0,
    frozen = false,
    status = "awaiting_ubo",
    accepted = true,
    lastPath = "";
  const auth = {
    user: { email: profile.email, email_confirmed_at: "2026-09-25" },
  };
  const db = {
    auth: { admin: { getUserById: async () => ({ data: auth }) } },
    from: (table: string) => {
      let singleton = false, shared = false, recentQuery = false;
      const q: any = {
        select: () => q,
        eq: () => q,
        neq: () => {
          shared = true;
          return q;
        },
        limit: () => q,
        in: () => q,
        gte: () => {
          recentQuery = true;
          return q;
        },
        maybeSingle: () => {
          singleton = true;
          return q;
        },
        then: (resolve: any) => {
          let data: any = [];
          if (table === "user_profiles" && singleton) {
            data = {
              ...profile,
              account_status: frozen ? "frozen" : "pending_kyc",
            };
          }
          if (table === "business_profiles" && singleton) data = business;
          if (shared) data = [];
          if (table === "email_log") {
            data = recentQuery
              ? (recent ? [{ id: "mail" }] : [])
              : (prior ? { status: "sent" } : null);
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  const bridge = async (request: any) => {
    assert(request.method === "GET", "provider mutation forbidden");
    lastPath = request.path;
    return {
      ok: true,
      data: request.path.endsWith("synthetic-customer")
        ? {
          email: profile.email,
          type: "business",
          full_name: business.company_name,
          status,
          has_accepted_terms_of_service: accepted,
        }
        : { url: "https://bridge.withpersona.com/verify?token=synthetic" },
    };
  };
  const send = async (payload: any) => {
    sent++;
    assert(payload.to === profile.email, "wrong recipient");
    assert(
      payload.props.verification_url.includes("token=synthetic"),
      "missing provider link",
    );
    assert(payload.idempotency_key.includes(id), "missing deduplication");
    return { ok: true, body: { success: true, data: { status: "sent" } } };
  };
  assert(
    (await remindBusiness(db, bridge, send, id, true)).status ===
        "would_send" && sent === 0,
    "dry run sent mail",
  );
  assert(
    (await remindBusiness(db, bridge, send, id, false)).status ===
        "email_requested" && sent === 1,
    "dispatch failed",
  );
  status = "active";
  assert(
    (await remindBusiness(db, bridge, send, id, false)).reason ===
      "no_customer_action_required",
    "active user emailed",
  );
  status = "under_review";
  assert(
    (await remindBusiness(db, bridge, send, id, false)).reason ===
      "no_customer_action_required",
    "review user emailed",
  );
  status = "awaiting_ubo";
  recent = true;
  assert(
    (await remindBusiness(db, bridge, send, id, false)).reason ===
      "recent_onboarding_email",
    "recent user emailed twice",
  );
  recent = false;
  prior = true;
  assert(
    (await remindBusiness(db, bridge, send, id, false)).reason ===
      "already_requested",
    "retry duplicated email",
  );
  prior = false;
  frozen = true;
  assert(
    (await remindBusiness(db, bridge, send, id, false)).reason ===
      "account_restricted",
    "frozen user emailed",
  );
  frozen = false;
  accepted = false;
  await remindBusiness(db, bridge, send, id, true);
  assert(lastPath.endsWith("tos_acceptance_link"), "terms skipped");
});
