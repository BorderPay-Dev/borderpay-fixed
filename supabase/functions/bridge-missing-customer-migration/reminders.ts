import { providerLinkReason, restrictionReason } from "./policy.ts";
import { isBridgeBlocked } from "../_shared/providers/bridge-country-policy.ts";
const ACTIONABLE = new Set([
  "not_started",
  "incomplete",
  "awaiting_ubo",
  "awaiting_ubos",
  "needs_ubos",
  "awaiting_rfi",
  "awaiting_questionnaire",
]);
export function reminderStage(customer: any): string | null {
  const status = String(customer.status || "").toLowerCase();
  if (!ACTIONABLE.has(status)) return null;
  if (["awaiting_ubo", "awaiting_ubos", "needs_ubos"].includes(status)) {
    return "needs_ubos";
  }
  return status === "not_started" ? "not_started" : "incomplete";
}
export function safeLink(payload: any): string {
  const p = payload?.data ?? payload;
  const link = p?.url ||
    (typeof p?.kyc_link === "string" ? p.kyc_link : p?.kyc_link?.url) ||
    p?.link;
  const url = new URL(link);
  if (
    url.protocol !== "https:" || url.username || url.password ||
    !["bridge.xyz", "bridge.withpersona.com"].some((host) =>
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    )
  ) throw new Error("untrusted_verification_link");
  return url.toString();
}
export function actionMessage(stage: string, terms: boolean): string {
  const message = stage === "needs_ubos"
    ? "Please complete the requested beneficial-owner (UBO) and control-person information. Open your verification link, add or correct the requested details, and complete any identity checks shown."
    : stage === "not_started"
    ? "Please start your business verification. Have your company registration documents and ownership details ready, then follow the steps in your verification link."
    : "Your business verification needs additional information. Open your verification link to review and complete the missing company, ownership, or supporting-document requirements.";
  return terms
    ? `${message} First, use the button below to review and accept the Terms of Service. Then return to your BorderPay dashboard and select Continue verification.`
    : message;
}
export type ReminderResult = {
  user_id: string;
  status: string;
  reason?: string;
  stage?: string;
  terms_first?: boolean;
  email_status?: string;
};
export async function remindBusiness(
  db: any,
  bridge: any,
  send: any,
  userId: string,
  dryRun = true,
): Promise<ReminderResult> {
  const skipped = (reason: string) => ({
    user_id: userId,
    status: "skipped",
    reason,
  });
  const { data: p, error: pe } = await db.from("user_profiles").select("*").eq(
    "id",
    userId,
  ).maybeSingle();
  const { data: b, error: be } = await db.from("business_profiles").select("*")
    .eq("user_id", userId).maybeSingle();
  if (pe || be || !p || !b) return skipped("profile_mapping_requires_review");
  if (p.account_type !== "business") return skipped("business_only");
  const { data: auth, error: ae } = await db.auth.admin.getUserById(userId);
  if (ae || !auth?.user) return skipped("auth_user_unavailable");
  const restriction = restrictionReason(p, b, auth.user);
  if (restriction) return skipped(restriction);
  if (!auth.user.email_confirmed_at) return skipped("email_not_verified");
  if (isBridgeBlocked(b.country || p.country)) {
    return skipped("country_blocked");
  }
  const id = b.bridge_customer_id || p.bridge_customer_id;
  if (!id || String(id).startsWith("demo_")) {
    return skipped("missing_customer_id");
  }
  if (
    b.bridge_customer_id && p.bridge_customer_id &&
    b.bridge_customer_id !== p.bridge_customer_id
  ) return skipped("conflicting_customer_ids");
  for (
    const [table, column] of [["user_profiles", "id"], [
      "business_profiles",
      "user_id",
    ]]
  ) {
    const { data, error } = await db.from(table).select(column).eq(
      "bridge_customer_id",
      id,
    ).neq(column, userId).limit(1);
    if (error || data?.length) return skipped("shared_customer_mapping");
  }
  const customerResult = await bridge({
    method: "GET",
    path: `/v0/customers/${encodeURIComponent(id)}`,
    retryable: false,
  });
  if (!customerResult.ok) {
    return skipped(
      customerResult.status === 404
        ? "bridge_customer_not_found"
        : "provider_unavailable",
    );
  }
  const customer = customerResult.data?.data ?? customerResult.data;
  const identity = providerLinkReason(customer, p, b);
  if (identity) return skipped(identity);
  const stage = reminderStage(customer);
  if (!stage) return skipped("no_customer_action_required");
  const key = `business-kyb-resume-20260925:${userId}:${stage}`;
  const { data: sent, error: se } = await db.from("email_log").select("status")
    .eq("idempotency_key", key).maybeSingle();
  if (se) return skipped("email_history_unavailable");
  if (sent) {
    return { ...skipped("already_requested"), email_status: sent.status };
  }
  const { data: recent, error: re } = await db.from("email_log").select("id")
    .eq("user_id", userId).eq("status", "sent")
    .in("template", [
      "business.onboarding_lifecycle",
      "business.verification_reminder",
      "business.email_verification",
    ])
    .gte("sent_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .limit(1);
  if (re) return skipped("email_history_unavailable");
  if (recent?.length) return skipped("recent_onboarding_email");
  const terms = customer.has_accepted_terms_of_service !== true;
  const result = await bridge({
    method: "GET",
    path: `/v0/customers/${encodeURIComponent(id)}/${
      terms ? "tos_acceptance_link" : "kyc_link"
    }`,
    retryable: false,
  });
  if (!result.ok) return skipped("verification_link_unavailable");
  let url: string;
  try {
    url = safeLink(result.data);
  } catch {
    return skipped("invalid_verification_link");
  }
  if (dryRun) {
    return { user_id: userId, status: "would_send", stage, terms_first: terms };
  }
  // Recheck restrictions immediately before dispatch; never change account or KYB state.
  const { data: fresh, error: fe } = await db.from("user_profiles").select("*")
    .eq("id", userId).maybeSingle();
  if (
    fe || !fresh || restrictionReason(fresh, b, auth.user) ||
    fresh.email !== p.email
  ) return skipped("account_changed_before_send");
  const response = await send({
    template: "business.verification_reminder",
    to: p.email,
    user_id: userId,
    idempotency_key: key,
    props: {
      full_name: p.full_name,
      company_name: b.company_name,
      verification_url: url,
      action_message: actionMessage(stage, terms),
    },
  });
  return {
    user_id: userId,
    status: response.ok && response.body?.success
      ? "email_requested"
      : "email_failed",
    stage,
    terms_first: terms,
    email_status: response.body?.data?.status ||
      (response.ok && response.body?.success ? "sent" : "failed"),
  };
}
