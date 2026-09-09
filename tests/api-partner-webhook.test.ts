import {
  ApiWebhookSecurityError,
  decryptApiWebhookSecret,
  encryptApiWebhookSecret,
  signApiWebhookPayload,
  validateApiWebhookEndpointUrl,
} from "../supabase/functions/_shared/api-webhook-security.ts";
import {
  enqueuePartnerBridgeEvent,
  projectBridgePartnerEvent,
} from "../supabase/functions/_shared/api-partner-events.ts";
import { validateWebhookCreate } from "../supabase/functions/_shared/api-gateway-validators.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`expected ${right}, received ${left}`);
}

async function assertRejects(
  operation: () => Promise<unknown>,
  errorType: abstract new (...args: any[]) => Error,
  messageIncludes?: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof errorType, `unexpected error type: ${error}`);
    if (messageIncludes) assert(String((error as Error).message).includes(messageIncludes), `missing error text: ${messageIncludes}`);
    return;
  }
  throw new Error("expected operation to reject");
}

function assertStringIncludes(actual: string, expected: string): void {
  assert(actual.includes(expected), `expected ${actual} to include ${expected}`);
}

const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(17)));

Deno.test("webhook secret encrypts and decrypts only for its endpoint/version", async () => {
  const encrypted = await encryptApiWebhookSecret("bwhsec_test", "endpoint-a", 1, TEST_KEY);
  assert(encrypted.ciphertext !== "bwhsec_test");
  assertEquals(
    await decryptApiWebhookSecret(encrypted.ciphertext, encrypted.nonce, "endpoint-a", 1, TEST_KEY),
    "bwhsec_test",
  );
  await assertRejects(
    () => decryptApiWebhookSecret(encrypted.ciphertext, encrypted.nonce, "endpoint-b", 1, TEST_KEY),
    ApiWebhookSecurityError,
  );
  await assertRejects(
    () => decryptApiWebhookSecret(encrypted.ciphertext, encrypted.nonce, "endpoint-a", 2, TEST_KEY),
    ApiWebhookSecurityError,
  );
});

Deno.test("webhook signature binds timestamp and exact body", async () => {
  const first = await signApiWebhookPayload("secret", "1700000000", '{"ok":true}');
  const same = await signApiWebhookPayload("secret", "1700000000", '{"ok":true}');
  const changed = await signApiWebhookPayload("secret", "1700000001", '{"ok":true}');
  assertEquals(first, same);
  assert(first.startsWith("v1="));
  assert(first !== changed);
});

Deno.test("webhook endpoints require public HTTPS hosts", () => {
  assertEquals(validateApiWebhookEndpointUrl("https://hooks.partner.example/events"), "https://hooks.partner.example/events");
  for (const url of [
    "http://hooks.partner.example/events",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://service.internal/hook",
    "https://user:pass@hooks.partner.example/hook",
  ]) {
    let rejected = false;
    try {
      validateApiWebhookEndpointUrl(url);
    } catch {
      rejected = true;
    }
    assert(rejected, `expected URL rejection: ${url}`);
    assertEquals(validateWebhookCreate({ endpoint_url: url }).ok, false);
  }
});

Deno.test("Bridge lifecycle projection emits minimal owned resource data", () => {
  const projected = projectBridgePartnerEvent({
    source: "bridge",
    event_id: "bridge:evt_1",
    event_type: "transfer.updated",
    payload: {
      event_object: {
        id: "transfer_123",
        state: "completed",
        amount: "12.50",
        currency: "usdc",
        bank_account_number: "must-not-leak",
      },
    },
  });
  assertEquals(projected, {
    eventType: "transfer.updated",
    resourceType: "transfer",
    providerResourceId: "transfer_123",
    payload: {
      resource: { id: "transfer_123", type: "transfer" },
      status: "completed",
      amount: "12.50",
      currency: "USDC",
    },
  });
  assert(!JSON.stringify(projected).includes("bank_account_number"));
});

Deno.test("non-Bridge and unsupported events are not projected", () => {
  assertEquals(projectBridgePartnerEvent({ source: "bridge_test", event_id: "x", event_type: "transfer.updated", payload: {} }), null);
  assertEquals(projectBridgePartnerEvent({ source: "bridge", event_id: "x", event_type: "unknown.updated", payload: { id: "x" } }), null);
});

Deno.test("provider event enqueues only through authoritative tenant ownership", async () => {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: async () => ({
                data: [{ id: "resource-row", tenant_id: "tenant-a", tenant_end_user_id: "end-user-a" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, ...args });
      return { data: "event-a", error: null };
    },
  };
  const result = await enqueuePartnerBridgeEvent(supabase, {
    source: "bridge",
    event_id: "bridge:evt_2",
    event_type: "wallet.updated",
    payload: { event_object: { id: "wallet-a", status: "active" } },
  });
  assertEquals(result, "enqueued");
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].name, "api_webhook_enqueue_event");
  assertEquals(rpcCalls[0].p_tenant_id, "tenant-a");
  assertEquals(rpcCalls[0].p_resource_id, "resource-row");
  assertStringIncludes(String(rpcCalls[0].p_idempotency_key), "bridge:evt_2");
});

Deno.test("unowned provider resource produces no partner delivery", async () => {
  let rpcCalled = false;
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      }),
    }),
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
  };
  assertEquals(await enqueuePartnerBridgeEvent(supabase, {
    source: "bridge",
    event_id: "bridge:evt_3",
    event_type: "customer.updated",
    payload: { event_object: { id: "customer-unowned", status: "active" } },
  }), "not_partner_owned");
  assertEquals(rpcCalled, false);
});

Deno.test("ownership and enqueue lookup errors fail closed", async () => {
  const lookupFailure = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "db unavailable" } }) }) }) }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
  await assertRejects(
    () => enqueuePartnerBridgeEvent(lookupFailure, {
      source: "bridge",
      event_id: "bridge:evt_4",
      event_type: "wallet.updated",
      payload: { event_object: { id: "wallet-a", status: "active" } },
    }),
    Error,
    "Partner resource lookup failed",
  );
});
