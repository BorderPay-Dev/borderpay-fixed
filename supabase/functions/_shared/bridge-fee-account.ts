export type FeeAccountInput = {
  account_owner_name: string;
  business_name: string;
  routing_number: string;
  account_number: string;
};

export function validateFeeAccountInput(value: unknown):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const accountOwnerName = String(input.account_owner_name || "").trim();
  const businessName = String(input.business_name || "").trim();
  const routingNumber = String(input.routing_number || "").trim();
  const accountNumber = String(input.account_number || "").trim();

  if (accountOwnerName.length < 2 || businessName.length < 2) {
    return { ok: false, error: "account_owner_name and business_name are required" };
  }
  if (!/^\d{9}$/.test(routingNumber)) {
    return { ok: false, error: "routing_number must contain exactly 9 digits" };
  }
  if (!/^\d+$/.test(accountNumber)) {
    return { ok: false, error: "account_number must contain digits only" };
  }

  return {
    ok: true,
    payload: {
      account_owner_name: accountOwnerName,
      account_type: "us",
      currency: "usd",
      account_owner_type: "business",
      business_name: businessName,
      account: {
        routing_number: routingNumber,
        account_number: accountNumber,
        checking_or_savings: "checking",
      },
    },
  };
}

export function redactFeeAccountResponse(value: unknown): Record<string, unknown> {
  const root = (value && typeof value === "object" ? value : {}) as Record<string, any>;
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, any>;
  const account = (data.account && typeof data.account === "object" ? data.account : {}) as Record<string, any>;
  const last4 = String(account.last_4 || data.last_4 || "").replace(/\D/g, "").slice(-4);
  return {
    configured: Boolean(data.id || data.external_account_id),
    id: data.id || data.external_account_id || null,
    active: typeof data.active === "boolean" ? data.active : null,
    account_type: data.account_type || null,
    currency: data.currency || null,
    last_4: last4 || null,
  };
}
