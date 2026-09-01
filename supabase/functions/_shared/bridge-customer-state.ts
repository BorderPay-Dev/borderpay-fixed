export type BridgeCustomerState =
  | "not_started" | "incomplete" | "under_review" | "approved" | "rejected"
  | "paused" | "offboarded" | "awaiting_rfi" | "needs_edd" | "needs_ubos";

const clean = (value: unknown): string => String(value ?? "").trim();

function unwrap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  return record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record;
}

export function normalizeBridgeCustomerState(raw: unknown): BridgeCustomerState {
  const value = clean(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (!value || ["none", "null", "not_started", "created"].includes(value)) return "not_started";
  if (["approved", "active", "authorized", "verified", "completed", "complete", "accepted", "full_enrollment", "passed"].includes(value)) return "approved";
  if (["under_review", "review_pending", "manual_review", "in_review", "review"].includes(value)) return "under_review";
  if (["awaiting_rfi", "rfi", "request_for_information", "needs_rfi"].includes(value)) return "awaiting_rfi";
  if (["needs_edd", "edd", "enhanced_due_diligence"].includes(value)) return "needs_edd";
  if (["needs_ubos", "needs_ubo", "awaiting_ubo", "awaiting_ubos", "ubo_required", "ubo_followup"].includes(value)) return "needs_ubos";
  if (["rejected", "failed", "declined", "denied", "not_approved"].includes(value)) return "rejected";
  if (["paused", "suspended", "blocked", "frozen", "restricted"].includes(value)) return "paused";
  if (["offboarded", "offboard", "terminated", "closed", "deleted", "deactivated"].includes(value)) return "offboarded";
  return "incomplete";
}

function first(customer: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (clean(customer[key])) return customer[key];
  return null;
}

export function deriveBridgeCustomerStates(
  raw: unknown,
  accountType: "individual" | "business",
): { account_status: BridgeCustomerState; verification_status: BridgeCustomerState } {
  const customer = unwrap(raw);
  const account = normalizeBridgeCustomerState(first(customer, ["status", "account_status", "customer_status"]));
  const verification = normalizeBridgeCustomerState(first(customer, accountType === "business"
    ? ["kyb_status", "verification_status", "kyc_status", "status"]
    : ["kyc_status", "verification_status", "status", "kyb_status"]));

  if (["paused", "offboarded", "rejected"].includes(account)) return { account_status: account, verification_status: verification };
  if (verification === "approved") return { account_status: "approved", verification_status: "approved" };
  if (verification === "under_review") return { account_status: "under_review", verification_status: "under_review" };
  if (["awaiting_rfi", "needs_edd", "needs_ubos"].includes(verification)) return { account_status: verification, verification_status: verification };
  if (verification === "rejected") return { account_status: "rejected", verification_status: "rejected" };
  if (verification === "not_started") return { account_status: "not_started", verification_status: "not_started" };
  return { account_status: "incomplete", verification_status: "incomplete" };
}
