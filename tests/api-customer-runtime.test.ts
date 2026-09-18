import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import {
  apiBeneficiaryRequest,
  apiPaymentRequest,
  authenticateApiCustomer,
  callCustomerCore,
  CustomerApiError,
  handleCustomerApi,
} from "../supabase/functions/_shared/api-customer-runtime.ts";
import { scaPayloadHash } from "../supabase/functions/_shared/sca.ts";
import { bridgeProvider } from "../supabase/functions/_shared/providers/bridge.ts";
import { evaluateApiRuntimeReleaseGate } from "../supabase/functions/_shared/public-api-v258/api-release-gates.ts";
const tenant = "11111111-1111-4111-8111-111111111111",
  user = "22222222-2222-4222-8222-222222222222";
const payment = {
  source: {
    payment_rail: "bridge_wallet",
    currency: "EURC",
    amount: "150.00",
    bridge_wallet_id: "wallet-a",
  },
  destination: {
    payment_rail: "base",
    currency: "EURC",
    external_wallet_id: "saved-a",
    address: "0x1111111111111111111111111111111111111111",
  },
};
const ctx = {
  tenantId: tenant,
  apiKeyId: "key",
  idempotencyKey: "intent-123456",
  maxSingleTransferUsd: "1000",
  maxSingleTransferEur: "1000",
};
const session = {
  userId: user,
  endUserId: "end-user",
  authorization: "Bearer customer-token",
};
function database(country = "FR", status = "active") {
  const calls: any[] = [];
  const db: any = {
    calls,
    auth: {
      getUser: async () => ({ data: { user: { id: user } }, error: null }),
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return { data: "resource-id", error: null };
    },
    from(table: string) {
      const q: any = {
        single: async () => ({ data: row(), error: null }),
        maybeSingle: async () => ({ data: row(), error: null }),
        then(resolve: any) {
          return Promise.resolve({ data: [row()], error: null }).then(resolve);
        },
      };
      const row = () =>
        table === "user_profiles"
          ? {
            id: user,
            account_type: "business",
            country: "PL",
            bridge_customer_id: "customer",
            bridge_kyc_status: "approved",
            account_status: status,
          }
          : table === "business_profiles"
          ? {
            user_id: user,
            country,
            bridge_customer_id: "customer",
            bridge_kyb_status: "approved",
          }
          : { id: "end-user", user_id: user };
      for (
        const method of [
          "select",
          "eq",
          "is",
          "gt",
          "order",
          "limit",
          "insert",
          "update",
          "upsert",
          "or",
        ]
      ) {
        q[method] = (...args: any[]) => {
          calls.push({ table, method, args });
          return q;
        };
      }
      return q;
    },
  };
  return db;
}
Deno.test("API customer session binds verified user to tenant; foreign mapping is denied", async () => {
  const db = database();
  assertEquals(
    (await authenticateApiCustomer(db, tenant, "Bearer token")).userId,
    user,
  );
  assertEquals(
    db.calls.some((c: any) =>
      c.table === "api_tenant_end_users" && c.method === "eq" &&
      c.args[0] === "tenant_id" && c.args[1] === tenant
    ),
    true,
  );
  await assertRejects(
    () => authenticateApiCustomer(db, tenant, ""),
    CustomerApiError,
  );
  db.from = () => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({ data: null, error: null }),
  });
  await assertRejects(
    () => authenticateApiCustomer(db, tenant, "Bearer token"),
    CustomerApiError,
    "does not belong",
  );
});
Deno.test("EEA authorization and execution hash identical canonical payment; all financial changes invalidate it", async () => {
  const a = apiPaymentRequest(
    { request: payment, pin: "123456", totp: "654321" },
    tenant,
    ctx.idempotencyKey,
  );
  const b = apiPaymentRequest(
    { ...payment, sca_authorization_id: "auth" },
    tenant,
    ctx.idempotencyKey,
  );
  assertEquals(
    await scaPayloadHash("bridge_transfer", a),
    await scaPayloadHash("bridge_transfer", b),
  );
  for (
    const variant of [{
      ...payment,
      source: { ...payment.source, amount: "151.00" },
    }, {
      ...payment,
      destination: {
        ...payment.destination,
        address: "0x2222222222222222222222222222222222222222",
      },
    }]
  ) {
    assertNotEquals(
      await scaPayloadHash("bridge_transfer", a),
      await scaPayloadHash(
        "bridge_transfer",
        apiPaymentRequest(variant, tenant, ctx.idempotencyKey),
      ),
    );
  }
  assertNotEquals(
    await scaPayloadHash("bridge_transfer", a),
    await scaPayloadHash(
      "bridge_transfer",
      apiPaymentRequest(payment, "other-tenant", ctx.idempotencyKey),
    ),
  );
  assertThrows(() =>
    apiPaymentRequest(
      { ...payment, developer_fee: { flat_amount: "0" } },
      tenant,
      ctx.idempotencyKey,
    )
  );
  assertThrows(() => apiPaymentRequest(payment, tenant, "short"));
});
Deno.test("beneficiary authorization hashes precisely the forwarded create/delete request", async () => {
  const create = apiBeneficiaryRequest({
    request: {
      account: {
        account_type: "gb",
        account_number: "12345678",
        sort_code: "123456",
      },
    },
  });
  const sent = { ...create, sca_authorization_id: "authorization" };
  assertEquals(
    await scaPayloadHash("bridge_external_account", create),
    await scaPayloadHash("bridge_external_account", sent),
  );
  assertEquals(
    apiBeneficiaryRequest({
      request: { action: "delete", external_account_id: "bank" },
    }),
    { action: "delete", external_account_id: "bank" },
  );
});
Deno.test("frozen partner customer fails before core or provider calls", async () => {
  await assertRejects(
    () =>
      handleCustomerApi(
        database("GB", "frozen"),
        "POST /v1/transfers",
        payment,
        ctx,
        session,
      ),
    CustomerApiError,
    "frozen",
  );
});
Deno.test("EEA API payment delegates PIN/TOTP authorization and transfer to canonical core, recording transfer ownership", async () => {
  const oldFetch = globalThis.fetch, oldWallets = bridgeProvider.listWallets;
  const urls: string[] = [], requests: any[] = [];
  Deno.env.set("SUPABASE_URL", "https://core.example");
  Deno.env.set("SUPABASE_ANON_KEY", "public-fixture");
  bridgeProvider.listWallets = async () => [{
    wallet_id: "wallet-a",
    currency: "USDC",
    chain: "base",
    address: "address",
    status: "active",
  }];
  globalThis.fetch = (async (url: any, init: any) => {
    urls.push(String(url));
    assertEquals(init.headers.Authorization, session.authorization);
    requests.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        success: true,
        data: String(url).endsWith("sca-authorize")
          ? { authorization_id: "sca" }
          : { transfer_id: "transfer-1", state: "succeeded" },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const db = database();
    await handleCustomerApi(
      db,
      "POST /v1/payment-authorizations",
      { request: payment, pin: "123456", totp: "123456" },
      ctx,
      session,
    );
    await handleCustomerApi(
      db,
      "POST /v1/transfers",
      { ...payment, sca_authorization_id: "sca" },
      ctx,
      session,
    );
    assertEquals(urls, [
      "https://core.example/functions/v1/sca-authorize",
      "https://core.example/functions/v1/bridge-transfer",
    ]);
    assertEquals(
      await scaPayloadHash("bridge_transfer", requests[0].request),
      await scaPayloadHash("bridge_transfer", requests[1]),
    );
    assertEquals(requests[1].sca_authorization_id, "sca");
    assertEquals(
      db.calls.some((c: any) =>
        c.name === "api_gateway_register_tenant_resource" &&
        c.args.p_provider_resource_id === "transfer-1"
      ),
      true,
    );
  } finally {
    globalThis.fetch = oldFetch;
    bridgeProvider.listWallets = oldWallets;
  }
});
Deno.test("UK incorporation uses PIN only; a different source owner never reaches core", async () => {
  const oldFetch = globalThis.fetch, oldWallets = bridgeProvider.listWallets;
  const urls: string[] = [];
  bridgeProvider.listWallets = async () => [{
    wallet_id: "wallet-a",
    currency: "USDC",
    chain: "base",
    address: "address",
    status: "active",
  }];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return new Response(
      JSON.stringify({
        success: true,
        data: { transfer_id: "transfer-2", state: "pending" },
      }),
    );
  }) as typeof fetch;
  try {
    const p = {
      ...payment,
      source: { ...payment.source, currency: "USDC" },
      destination: { ...payment.destination, currency: "USDC" },
      transaction_pin: "123456",
    };
    await handleCustomerApi(
      database("GB"),
      "POST /v1/transfers",
      p,
      ctx,
      session,
    );
    assertEquals(urls.map((u) => u.split("/").at(-1)), [
      "verify-pin",
      "bridge-transfer",
    ]);
    await assertRejects(
      () =>
        handleCustomerApi(
          database("GB"),
          "POST /v1/transfers",
          { ...p, source: { ...p.source, bridge_wallet_id: "foreign-wallet" } },
          ctx,
          session,
        ),
      CustomerApiError,
      "does not belong",
    );
    assertEquals(urls.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
    bridgeProvider.listWallets = oldWallets;
  }
});
Deno.test("core malformed response remains unconfirmed, core errors preserve error code", async () => {
  await assertRejects(
    () =>
      callCustomerCore(
        "bridge-transfer",
        "Bearer fixture",
        {},
        async () => new Response("<html>error</html>"),
      ),
    CustomerApiError,
    "could not be confirmed",
  );
  const result = await callCustomerCore(
    "bridge-transfer",
    "Bearer fixture",
    {},
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: "sca_invalid",
          error: "Expired authorization",
        }),
        { status: 403 },
      ),
  );
  assertEquals(result.status, 403);
  assertEquals(result.body.error.code, "sca_invalid");
});
Deno.test("sandbox label cannot call production provider for reads, onboarding or writes", () => {
  const flags = {
    API_PARTNER_PRODUCTION_ENABLED: "true",
    API_PARTNER_PROVIDER_WRITES_ENABLED: "true",
    API_PARTNER_SANDBOX_WRITES_ENABLED: "true",
    API_PARTNER_MONEY_MOVEMENT_ENABLED: "true",
    API_PARTNER_PROVIDER_ENVIRONMENT: "sandbox",
    BRIDGE_BASE_URL: "https://api.bridge.xyz",
  };
  for (
    const route of [
      "GET /v1/balances",
      "POST /v1/onboarding-authorizations",
      "POST /v1/payment-authorizations",
      "POST /v1/external-accounts",
    ]
  ) {
    assertEquals(
      evaluateApiRuntimeReleaseGate("sandbox", route, flags).allowed,
      false,
    );
  }
  assertEquals(
    evaluateApiRuntimeReleaseGate("sandbox", "GET /v1/health", flags).allowed,
    true,
  );
});
