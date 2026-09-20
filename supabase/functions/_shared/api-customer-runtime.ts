import { getFinancialAccessBlock } from "./account-access.ts";
import { loadAndAssertBridgeIdentityInvariant } from "./bridge-identity-invariant.ts";
import {
  resolveBridgeScaScope,
  resolveBridgeWalletAssetScope,
} from "./bridge-sca-scope.ts";
import { bridgeProvider } from "./providers/bridge.ts";
import { selectVaLinkedBaseWallet } from "../../../utils/financial/vaLinkedWalletPresentation.ts";
import {
  assertTenantResource,
  registerTenantResource,
} from "./public-api-v258/api-tenant-ownership.ts";
import {
  enqueueApiResourceEvent,
  enqueuePartnerBridgeEvent,
} from "./public-api-v258/api-partner-events.ts";
import { authorizeSingleTransferAmount } from "./public-api-v258/api-financial-authorization.ts";

export const CUSTOMER_API_SCOPES: Record<string, string> = {
  "GET /v1/customers": "customers:read",
  "POST /v1/customers": "customers:write",
  "POST /v1/verification-links": "onboarding:write",
  "GET /v1/wallets": "wallets:read",
  "GET /v1/balances": "wallets:read",
  "POST /v1/wallets": "wallets:write",
  "GET /v1/virtual-accounts": "virtual_accounts:read",
  "POST /v1/virtual-accounts": "virtual_accounts:write",
  "GET /v1/external-accounts": "external_accounts:read",
  "POST /v1/external-accounts": "external_accounts:write",
  "DELETE /v1/external-accounts": "external_accounts:write",
  "GET /v1/external-wallets": "wallets:read",
  "POST /v1/external-wallets": "wallets:write",
  "DELETE /v1/external-wallets": "wallets:write",
  "GET /v1/transfers": "transfers:read",
  "POST /v1/transfers": "transfers:write",
  "POST /v1/payouts": "payouts:write",
  "POST /v1/payment-authorizations": "transfers:write",
  "POST /v1/beneficiary-authorizations": "external_accounts:write",
};
export class CustomerApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}
export type CustomerApiContext = {
  tenantId: string;
  apiKeyId: string;
  maxSingleTransferUsd: string | null;
  maxSingleTransferEur: string | null;
  idempotencyKey: string;
};
export type CustomerSession = {
  userId: string;
  endUserId: string;
  authorization: string;
};
export async function authenticateApiCustomer(
  db: any,
  tenantId: string,
  authorization: string,
): Promise<CustomerSession> {
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new CustomerApiError(
      "customer_session_required",
      "A BorderPay end-customer session is required.",
      401,
    );
  }
  const { data, error } = await db.auth.getUser(
    authorization.replace(/^Bearer\s+/i, ""),
  );
  if (error || !data?.user?.id) {
    throw new CustomerApiError(
      "customer_session_invalid",
      "The customer session has expired.",
      401,
    );
  }
  const owner = await db.from("api_tenant_end_users").select("id,user_id").eq(
    "tenant_id",
    tenantId,
  ).eq("user_id", data.user.id).maybeSingle();
  if (owner.error || !owner.data) {
    throw new CustomerApiError(
      "tenant_resource_forbidden",
      "This customer does not belong to this partner.",
      403,
    );
  }
  return { userId: data.user.id, endUserId: owner.data.id, authorization };
}
const pick = (v: any, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => v?.[k] !== undefined).map((k) => [k, v[k]]),
  );
/** Only the canonical customer payload is authorized and forwarded. No partner fees or owner overrides. */
export function apiPaymentRequest(
  body: any,
  tenantId: string,
  idempotencyKey: string,
) {
  const t = body.transfer ?? body.request ?? body;
  if (!/^[\x21-\x7e]{8,64}$/.test(idempotencyKey)) {
    throw new CustomerApiError(
      "invalid_request",
      "Use an Idempotency-Key of 8–64 characters.",
    );
  }
  if (t.idempotency_key && t.idempotency_key !== idempotencyKey) {
    throw new CustomerApiError(
      "invalid_request",
      "Body idempotency_key must match the Idempotency-Key header.",
    );
  }
  if (t.developer_fee || t.on_behalf_of || t.destination?.bank_account) {
    throw new CustomerApiError(
      "invalid_request",
      "Fees and customer ownership are controlled by BorderPay. Use a saved destination.",
    );
  }
  const source = pick(t.source, [
    "payment_rail",
    "currency",
    "amount",
    "bridge_wallet_id",
  ]);
  const destination = pick(t.destination, [
    "payment_rail",
    "currency",
    "bridge_wallet_id",
    "external_account_id",
    "external_wallet_id",
    "address",
  ]);
  source.currency = String(source.currency || "").toUpperCase();
  destination.currency = String(destination.currency || "").toUpperCase();
  source.payment_rail = String(source.payment_rail || "").toLowerCase();
  destination.payment_rail = String(destination.payment_rail || "")
    .toLowerCase();
  if (
    source.payment_rail !== "bridge_wallet" || !source.bridge_wallet_id ||
    !["USDC", "USDT", "EURC"].includes(source.currency) ||
    !/^\d+(\.\d{1,6})?$/.test(String(source.amount || "")) ||
    Number(source.amount) <= 0
  ) {
    throw new CustomerApiError(
      "invalid_request",
      "Choose a funding wallet and a positive stablecoin amount.",
    );
  }
  if (
    !["bridge_wallet", "base", "tron", "ach", "wire", "sepa", "faster_payments"]
      .includes(destination.payment_rail)
  ) {
    throw new CustomerApiError(
      "invalid_request",
      "Unsupported destination rail.",
    );
  }
  if (
    ["base", "tron"].includes(destination.payment_rail) &&
    (!destination.external_wallet_id || !destination.address)
  ) {
    throw new CustomerApiError(
      "invalid_request",
      "Select a saved external wallet and its address.",
    );
  }
  return {
    source,
    destination,
    idempotency_key: `api:${tenantId}:${idempotencyKey}`,
  };
}
export function apiBeneficiaryRequest(body: any) {
  const r = body.request ?? body;
  if (r.action === "delete") {
    if (!r.external_account_id) {
      throw new CustomerApiError(
        "invalid_request",
        "external_account_id is required.",
      );
    }
    return {
      action: "delete",
      external_account_id: String(r.external_account_id),
    };
  }
  if (!r.account || !["us", "iban", "gb"].includes(r.account.account_type)) {
    throw new CustomerApiError(
      "invalid_request",
      "A US, IBAN or GB bank account is required.",
    );
  }
  return { action: "create", account: r.account };
}
export async function callCustomerCore(
  endpoint: string,
  authorization: string,
  body: unknown,
  fetchImpl = fetch,
) {
  // Never accept a URL, token or function name from the partner payload.
  const base = Deno.env.get("SUPABASE_URL")!;
  const response = await fetchImpl(`${base}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      "Content-Type": "application/json",
      "X-BorderPay-Channel": "web",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });
  const data = await response.json().catch(() => null);
  if (!data || typeof data.success !== "boolean") {
    throw new CustomerApiError(
      "response_unconfirmed",
      "The response could not be confirmed. Retry with the same Idempotency-Key.",
      503,
    );
  }
  if (!response.ok || !data.success) {
    const error = new CustomerApiError(
      String(data.code || "customer_action_failed"),
      String(
        data.error?.message || data.error ||
          "The action could not be completed.",
      ),
      response.status >= 400 ? response.status : 502,
    );
    // Accepted transfers can have a terminal failure. Preserve their ID for reconciliation.
    return {
      status: error.status,
      body: {
        success: false,
        error: { code: error.code, message: error.message },
        ...(data.data ? { data: data.data } : {}),
      },
    };
  }
  return { status: 200, body: data };
}
async function requireCustomerAccess(db: any, userId: string) {
  const blocked = await getFinancialAccessBlock(db, userId);
  if (blocked) throw new CustomerApiError(blocked.code, blocked.error, 423);
  const identity = await loadAndAssertBridgeIdentityInvariant(db, userId);
  if (!identity.ok) {
    throw new CustomerApiError(
      "customer_identity_unavailable",
      "Customer identity could not be verified.",
      409,
    );
  }
  return identity.context;
}
async function register(
  db: any,
  ctx: CustomerApiContext,
  session: CustomerSession,
  type: any,
  id: string,
  status?: string,
) {
  const resourceId = await registerTenantResource(db, {
    tenantId: ctx.tenantId,
    tenantEndUserId: session.endUserId,
    apiKeyId: ctx.apiKeyId,
    resourceType: type,
    providerResourceId: id,
    providerStatus: status,
  });
  if (["customer", "wallet", "virtual_account", "transfer"].includes(type)) {
    const projection = await db.from("api_tenant_resources").upsert({
      tenant_id: ctx.tenantId,
      resource_type: type,
      provider_resource_id: id,
      state: status || null,
      safe_metadata: {},
    }, {
      onConflict: "tenant_id,resource_type,provider_resource_id",
      ignoreDuplicates: true,
    });
    if (projection.error) {
      throw new CustomerApiError(
        "projection_pending",
        "Resource is accepted; retry with the same Idempotency-Key to finish recording it.",
        503,
      );
    }
  }
  // Close the provider-event race: completed events may predate resource registration.
  // Enqueue uses the same provider:event_id idempotency key as the live SQL trigger.
  if (/^[a-zA-Z0-9_-]+$/.test(id)) {
    const events = await db.from("pending_events").select(
      "event_id,event_type,source,payload",
    ).eq("source", "bridge").eq("status", "completed")
      .or(
        `payload->>event_object_id.eq.${id},payload->event_object->>id.eq.${id},payload->data->>id.eq.${id}`,
      ).limit(100);
    if (events.error) {
      throw new CustomerApiError(
        "events_pending",
        "Resource is accepted; retry with the same Idempotency-Key to finish its event registration.",
        503,
      );
    }
    for (const event of events.data || []) {
      await enqueuePartnerBridgeEvent(db, event);
    }
  }
  return resourceId;
}
export async function handleCustomerApi(
  db: any,
  route: string,
  body: any,
  ctx: CustomerApiContext,
  session: CustomerSession,
) {
  const identity = await requireCustomerAccess(db, session.userId);
  const core = (endpoint: string, payload: unknown) =>
    callCustomerCore(endpoint, session.authorization, payload);
  const customerId = identity.bridge_customer_id;
  if (body.customer_id && body.customer_id !== customerId) {
    throw new CustomerApiError(
      "tenant_resource_forbidden",
      "The customer ID does not match this session.",
      403,
    );
  }
  if (
    route === "POST /v1/customers" || route === "POST /v1/verification-links"
  ) {
    const result = await core(
      identity.account_type === "business"
        ? "bridge-kyb-link"
        : "bridge-kyc-link",
      {},
    );
    const refreshed = await loadAndAssertBridgeIdentityInvariant(
      db,
      session.userId,
    );
    const id = refreshed.ok ? refreshed.context.bridge_customer_id : null;
    if (id) await register(db, ctx, session, "customer", id);
    if (result.body.success) {
      result.body.data = {
        ...result.body.data,
        customer_id: id,
        account_type: identity.account_type,
      };
    }
    return result;
  }
  if (route === "GET /v1/customers") {
    return {
      status: 200,
      body: {
        success: true,
        data: {
          customer_id: customerId,
          account_type: identity.account_type,
          verification_status: identity.verification_status,
        },
      },
    };
  }
  if (!customerId || identity.verification_status !== "approved") {
    throw new CustomerApiError(
      "verification_required",
      "Complete customer verification before using financial services.",
      409,
    );
  }
  await register(db, ctx, session, "customer", customerId);

  if (route === "POST /v1/wallets") {
    const result = await core("bridge-wallet", pick(body, ["symbol", "chain"]));
    if (result.body.success && result.body.data?.wallet_id) {
      await register(db, ctx, session, "wallet", result.body.data.wallet_id);
    }
    return result;
  }
  if (route === "POST /v1/virtual-accounts") {
    // Core selects the one VA-linked Base wallet and regional settlement asset.
    if (body.destination) {
      throw new CustomerApiError(
        "invalid_request",
        "Do not set destination: BorderPay selects the regional Base settlement wallet.",
      );
    }
    const result = await core("bridge-virtual-account", {
      currency: String(body.currency || "").toUpperCase(),
    });
    const accounts = await bridgeProvider.listVirtualAccounts(customerId);
    for (const a of accounts) {
      await register(
        db,
        ctx,
        session,
        "virtual_account",
        a.virtual_account_id,
        a.status,
      );
    }
    return result;
  }
  if (
    ["GET /v1/wallets", "GET /v1/balances", "GET /v1/virtual-accounts"]
      .includes(route)
  ) {
    // Evaluate the database's current read policy as the customer, including its release control.
    const readResponse = await fetch(
      `${
        Deno.env.get("SUPABASE_URL")
      }/rest/v1/rpc/can_read_bridge_financial_data`,
      {
        method: "POST",
        headers: {
          Authorization: session.authorization,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_user_id: session.userId }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!readResponse.ok || await readResponse.json() !== true) {
      throw new CustomerApiError(
        "sca_wallet_access_required",
        "Unlock wallet access in the BorderPay customer app.",
        403,
      );
    }
    const regional = await resolveBridgeWalletAssetScope(db, session.userId);
    if (regional.region === "unknown") {
      throw new CustomerApiError(
        "wallet_scope_unavailable",
        "Wallet region is temporarily unavailable.",
        503,
      );
    }
    const [wallets, vas] = await Promise.all([
      bridgeProvider.listWallets(customerId),
      bridgeProvider.listVirtualAccounts(customerId),
    ]);
    const base = selectVaLinkedBaseWallet(
      wallets.map((w) => ({ ...w, status: w.status || "active" })),
      vas,
    );
    const visible = wallets.filter((w) =>
      w.chain === "base"
        ? w.wallet_id === base?.wallet_id
        : regional.allow_usdt_tron && w.chain === "tron"
    );
    for (const w of visible) {
      await register(db, ctx, session, "wallet", w.wallet_id, w.status);
    }
    if (route === "GET /v1/virtual-accounts") {
      for (const v of vas) {
        await register(
          db,
          ctx,
          session,
          "virtual_account",
          v.virtual_account_id,
          v.status,
        );
      }
      return {
        status: 200,
        body: {
          success: true,
          data: {
            virtual_accounts: vas.map((v) =>
              pick(v, [
                "virtual_account_id",
                "currency",
                "status",
                "source_deposit_instructions",
                "destination",
                "account_details",
              ])
            ),
          },
        },
      };
    }
    const result = await Promise.all(visible.map(async (w) => ({
      wallet_id: w.wallet_id,
      chain: w.chain,
      address: w.address,
      status: w.status,
      balances:
        (await bridgeProvider.getWalletBalances(customerId, w.wallet_id))
          .filter((b) =>
            w.chain === "base"
              ? (b.currency.toUpperCase() === "USDC" ||
                (regional.allow_eurc_base &&
                  b.currency.toUpperCase() === "EURC"))
              : b.currency.toUpperCase() === "USDT"
          ),
    })));
    return { status: 200, body: { success: true, data: { wallets: result } } };
  }
  if (route === "GET /v1/external-accounts") {
    const result = await core("bridge-external-account", { action: "list" });
    if (result.body.success) {
      for (const a of result.body.data?.external_accounts || []) {
        const id = a.external_account_id || a.bridge_external_account_id ||
          a.id;
        if (id) {
          await register(db, ctx, session, "external_account", id, a.status);
        }
      }
    }
    return result;
  }
  if (route === "POST /v1/beneficiary-authorizations") {
    const request = apiBeneficiaryRequest(body);
    return await core("sca-authorize", {
      action: "authorize",
      operation: "beneficiary_change",
      resource: "bridge_external_account",
      request,
      pin: body.pin,
      totp: body.totp,
    });
  }
  if (
    route === "POST /v1/external-accounts" ||
    route === "DELETE /v1/external-accounts"
  ) {
    const request = apiBeneficiaryRequest({
      account: body.account,
      external_account_id: body.external_account_id,
      action: route.startsWith("DELETE") ? "delete" : "create",
    });
    return await core("bridge-external-account", {
      ...request,
      sca_authorization_id: body.sca_authorization_id,
    });
  }
  if (route.endsWith("/v1/external-wallets")) {
    const action = route.startsWith("GET")
      ? "list"
      : route.startsWith("DELETE")
      ? "remove"
      : "add";
    return await core("external-wallet", {
      ...pick(body, ["id", "label", "asset", "chain", "address"]),
      action,
    });
  }
  if (route === "GET /v1/transfers") {
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 25));
    let query = db.from("api_tenant_provider_resources").select(
      "id,provider_resource_id,provider_status,created_at",
    ).eq("tenant_id", ctx.tenantId).eq("tenant_end_user_id", session.endUserId)
      .eq("resource_type", "transfer").order("id", { ascending: true }).limit(
        limit,
      );
    if (body.transfer_id) {
      query = query.eq("provider_resource_id", String(body.transfer_id));
    }
    if (body.after) {
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          body.after,
        )
      ) {
        throw new CustomerApiError(
          "invalid_request",
          "after must be the returned next_cursor.",
        );
      }
      query = query.gt("id", body.after);
    }
    const { data, error } = await query;
    if (error) {
      throw new CustomerApiError(
        "read_unavailable",
        "Transfers are temporarily unavailable.",
        503,
      );
    }
    const ids = (data || []).map((r: any) => r.provider_resource_id);
    const tx = ids.length
      ? await db.from("transactions").select(
        "bridge_transfer_id,status,amount,currency,created_at",
      ).eq("user_id", session.userId).in("bridge_transfer_id", ids)
      : { data: [], error: null };
    if (tx.error) {
      throw new CustomerApiError(
        "read_unavailable",
        "Transfer status is temporarily unavailable.",
        503,
      );
    }
    const rows = (data || []).map((r: any) => {
      const t = (tx.data || []).find((t: any) =>
        t.bridge_transfer_id === r.provider_resource_id
      );
      return {
        transfer_id: r.provider_resource_id,
        state: t?.status || r.provider_status,
        amount: t?.amount,
        currency: t?.currency,
        created_at: r.created_at,
      };
    });
    return {
      status: 200,
      body: {
        success: true,
        data: {
          transfers: rows,
          next_cursor: rows.length === limit ? data.at(-1).id : null,
        },
      },
    };
  }
  if (
    [
      "POST /v1/payment-authorizations",
      "POST /v1/transfers",
      "POST /v1/payouts",
    ].includes(route)
  ) {
    const payment = apiPaymentRequest(body, ctx.tenantId, ctx.idempotencyKey);
    // USD cap applies only to USD stablecoins; EURC uses a reviewed explicit EUR cap.
    const cap = payment.source.currency === "EURC"
      ? ctx.maxSingleTransferEur
      : ctx.maxSingleTransferUsd;
    authorizeSingleTransferAmount(payment.source.amount, cap ?? null);
    const wallets = await bridgeProvider.listWallets(customerId);
    if (!wallets.some((w) => w.wallet_id === payment.source.bridge_wallet_id)) {
      throw new CustomerApiError(
        "tenant_resource_forbidden",
        "Funding wallet does not belong to this customer.",
        403,
      );
    }
    if (
      payment.destination.bridge_wallet_id &&
      !wallets.some((w) => w.wallet_id === payment.destination.bridge_wallet_id)
    ) {
      await assertTenantResource(
        db,
        ctx.tenantId,
        "wallet",
        payment.destination.bridge_wallet_id,
      );
    }
    if (route === "POST /v1/payment-authorizations") {
      return await core("sca-authorize", {
        action: "authorize",
        operation: "payment",
        resource: "bridge_transfer",
        request: payment,
        pin: body.pin,
        totp: body.totp,
      });
    }
    const scope = await resolveBridgeScaScope(db, session.userId, "payment");
    if (scope.status === "unknown") {
      throw new CustomerApiError(
        "sca_scope_unavailable",
        "Payment authentication is temporarily unavailable.",
        503,
      );
    }
    if (!scope.required) {
      const pin = await core("verify-pin", {
        pin: String(body.transaction_pin || ""),
      });
      if (!pin.body.success) return pin;
    }
    const result = await core("bridge-transfer", {
      ...payment,
      sca_authorization_id: body.sca_authorization_id,
    });
    const transferId = result.body.data?.transfer_id;
    if (transferId) {
      const resourceId = await register(
        db,
        ctx,
        session,
        "transfer",
        transferId,
        result.body.data.provider_state || result.body.data.state,
      );
      await enqueueApiResourceEvent(db, {
        tenantId: ctx.tenantId,
        tenantEndUserId: session.endUserId,
        resourceId,
        eventType: route.endsWith("/payouts")
          ? "payout.created"
          : "transfer.created",
        idempotencyKey: `api:transfer.created:${transferId}`,
        payload: {
          resource: { id: transferId, type: "transfer" },
          status: result.body.data.state,
          amount: payment.source.amount,
          currency: payment.source.currency,
        },
      });
    }
    return result;
  }
  throw new CustomerApiError("not_found", "Unknown customer API route.", 404);
}
