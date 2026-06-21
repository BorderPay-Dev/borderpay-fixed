// bridge-external-account — manage a customer's fiat payout (offramp) destinations.
//
// v1 supports two Bridge external-account types:
//   • us   — USD bank account (account_number + routing_number). Usable for
//            ACH / ACH same-day / Wire payouts (rail chosen at transfer time).
//   • iban — EUR bank account (IBAN + BIC). SEPA.
//
// Actions (single POST endpoint, switched on body.action):
//   • create  → POST   /v0/customers/{customerId}/external_accounts
//   • list    → GET    /v0/customers/{customerId}/external_accounts (passthrough;
//               the dashboard normally reads the local mirror via RLS instead)
//   • delete  → DELETE /v0/customers/{customerId}/external_accounts/{id}
//
// Guards (mirror bridge-virtual-account):
//   • verify_jwt = true; caller identified from the bearer token.
//   • Country gate via isBridgeBlocked.
//   • Requires bridge_customer_id + bridge_kyc_status='approved'.
//
// This function is SOURCE ONLY in this PR — not deployed. It requires the
// BRIDGE_API_KEY function secret (consumed by ../_shared/providers/
// bridge-client.ts) and the public.bridge_external_accounts table from
// 20260529_bridge_external_accounts.sql before it can run.
//
// Deploy (later, operator):
//   supabase functions deploy bridge-external-account --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { requireMinimumWalletBalance } from "../_shared/funding-gate.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";

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

interface UsAccountInput {
  account_type: "us";
  account_owner_name: string;
  account_number: string;
  routing_number: string;
  bank_name?: string;
  address: { street_line_1: string; city: string; state?: string; postal_code: string; country: string };
}
interface IbanAccountInput {
  account_type: "iban";
  account_owner_name: string;
  account_owner_type: "individual" | "business";
  iban_number: string;
  bic_swift: string;
  iban_country: string;
  bank_name?: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
}
type CreateInput = UsAccountInput | IbanAccountInput;

const last4 = (s: string) => (s || "").replace(/\s+/g, "").slice(-4);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { action?: string; account?: CreateInput; external_account_id?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action || "create");

  // Shared customer/KYC/country guard.
  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) return json({ success: false, ...identity.failure }, 409);
  const profile = identity.context;
  if (isBridgeBlocked(profile?.country)) {
    return json(bridgeCountryBlockResponse(profile!.country!), 403);
  }
  logControlledBridgeTraffic("bridge-external-account", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    return json({ success: false, error: "Bridge customer required first", code: "no_customer" }, 409);
  }
  if (profile.verification_status !== "approved") {
    return json({ success: false, error: "KYC not approved yet", code: "kyc_not_approved" }, 409);
  }
  const customerId = profile.bridge_customer_id;

  // ── delete ────────────────────────────────────────────────────────────
  if (action === "delete") {
    const extId = String(body.external_account_id || "");
    if (!extId) return json({ success: false, error: "external_account_id required" }, 400);
    // Confirm ownership against the local mirror before touching Bridge.
    const { data: owned } = await supa
      .from("bridge_external_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("bridge_external_account_id", extId)
      .maybeSingle();
    if (!owned) return json({ success: false, error: "not found", code: "not_found" }, 404);
    const r = await bridgeFetch({
      method: "DELETE",
      path:   `/v0/customers/${encodeURIComponent(customerId)}/external_accounts/${encodeURIComponent(extId)}`,
    });
    if (!r.ok) return json({ success: false, error: r.error || `HTTP ${r.status}` }, 502);
    await supa.from("bridge_external_accounts")
      .update({ active: false, status: "deleted", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("bridge_external_account_id", extId);
    return json({ success: true, data: { deleted: true, external_account_id: extId } });
  }

  // ── list (passthrough; dashboard normally reads the local mirror) ──────
  if (action === "list") {
    const r = await bridgeFetch({
      method: "GET",
      path:   `/v0/customers/${encodeURIComponent(customerId)}/external_accounts`,
    });
    if (!r.ok) return json({ success: false, error: r.error || `HTTP ${r.status}` }, 502);
    return json({ success: true, data: (r.data as any)?.data ?? r.data });
  }

  // ── create ──────────────────────────────────────────────────────────
  // Paid gate: adding a payout destination is a money feature — requires an
  // activated (paid) plan. (list/delete stay open so users can always view /
  // remove existing destinations.)
  {
    const isBusiness = profile.account_type === "business";
    const __planGate = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!__planGate.allowed) return json(__planGate.body, __planGate.status);
  }
  const acct = body.account;
  if (!acct || (acct.account_type !== "us" && acct.account_type !== "iban")) {
    return json({ success: false, error: "account.account_type must be 'us' or 'iban'" }, 400);
  }
  if (!acct.account_owner_name) {
    return json({ success: false, error: "account_owner_name required" }, 400);
  }

  let bridgeBody: Record<string, unknown>;
  let currency: "USD" | "EUR";
  let railLabel: string;
  let derivedLast4: string;

  if (acct.account_type === "us") {
    const a = acct as UsAccountInput;
    if (!a.account_number || !a.routing_number) {
      return json({ success: false, error: "account_number and routing_number required for US accounts" }, 400);
    }
    if (!a.address?.street_line_1 || !a.address?.city || !a.address?.postal_code || !a.address?.country) {
      return json({ success: false, error: "full address required for US accounts" }, 400);
    }
    currency = "USD";
    railLabel = "ach";
    derivedLast4 = last4(a.account_number);
    bridgeBody = {
      currency:           "usd",
      account_type:       "us",
      account_owner_name: a.account_owner_name,
      ...(a.bank_name ? { bank_name: a.bank_name } : {}),
      account: { account_number: a.account_number, routing_number: a.routing_number },
      address: {
        street_line_1: a.address.street_line_1,
        city:          a.address.city,
        ...(a.address.state ? { state: a.address.state } : {}),
        postal_code:   a.address.postal_code,
        country:       a.address.country,
      },
    };
  } else {
    const a = acct as IbanAccountInput;
    if (!a.iban_number || !a.bic_swift || !a.iban_country) {
      return json({ success: false, error: "iban_number, bic_swift, and iban_country required for IBAN accounts" }, 400);
    }
    if (a.account_owner_type !== "individual" && a.account_owner_type !== "business") {
      return json({ success: false, error: "account_owner_type must be 'individual' or 'business'" }, 400);
    }
    if (a.account_owner_type === "individual" && (!a.first_name || !a.last_name)) {
      return json({ success: false, error: "first_name and last_name required for individual IBAN accounts" }, 400);
    }
    if (a.account_owner_type === "business" && !a.business_name) {
      return json({ success: false, error: "business_name required for business IBAN accounts" }, 400);
    }
    currency = "EUR";
    railLabel = "sepa";
    derivedLast4 = last4(a.iban_number);
    bridgeBody = {
      currency:           "eur",
      account_type:       "iban",
      account_owner_name: a.account_owner_name,
      account_owner_type: a.account_owner_type,
      ...(a.bank_name ? { bank_name: a.bank_name } : {}),
      ...(a.account_owner_type === "individual"
        ? { first_name: a.first_name, last_name: a.last_name }
        : { business_name: a.business_name }),
      iban: { account_number: a.iban_number, bic: a.bic_swift, country: a.iban_country },
    };
  }

  const r = await bridgeFetch({
    method:         "POST",
    path:           `/v0/customers/${encodeURIComponent(customerId)}/external_accounts`,
    body:           bridgeBody,
    idempotencyKey: `borderpay:extacct:${user.id}:${acct.account_type}:${derivedLast4}`,
  });
  if (!r.ok) return json({ success: false, error: r.error || `HTTP ${r.status}` }, 502);

  const data = (r.data as any)?.data ?? r.data;
  const extId = String(data?.id ?? "");
  if (!extId) return json({ success: false, error: "Bridge response missing external account id" }, 502);

  // Mirror locally — descriptors only, never full account / routing / IBAN.
  await supa.from("bridge_external_accounts").upsert({
    user_id:                    user.id,
    bridge_external_account_id: extId,
    bridge_customer_id:         customerId,
    account_type:               acct.account_type,
    currency,
    account_owner_name:         acct.account_owner_name,
    account_owner_type:         (acct as IbanAccountInput).account_owner_type ?? profile.account_type ?? null,
    bank_name:                  (acct as any).bank_name ?? data?.bank_name ?? null,
    last_4:                     data?.account?.last_4 ?? data?.iban?.last_4 ?? derivedLast4,
    rail:                       railLabel,
    status:                     "active",
    active:                     true,
    // Data minimization: store a sanitized boolean, NOT Bridge's raw
    // account_validation object. We never persist the vendor response
    // verbatim — only that validation was present.
    metadata:                   { validated: data?.account_validation != null },
    updated_at:                 new Date().toISOString(),
  }, { onConflict: "bridge_external_account_id" });

  return json({
    success: true,
    data: {
      external_account_id: extId,
      account_type:        acct.account_type,
      currency,
      rail:                railLabel,
      last_4:              data?.account?.last_4 ?? data?.iban?.last_4 ?? derivedLast4,
      bank_name:           (acct as any).bank_name ?? data?.bank_name ?? null,
    },
  });
});
