import assert from "node:assert/strict";
import {
  createKenyaRecipient,
  createKenyaTransfer,
  quoteKenyaDestinationAmount,
} from "../supabase/functions/_shared/providers/flutterwave-v4-payout.ts";
import { verifyFlutterwaveWebhookSignature } from "../supabase/functions/_shared/providers/flutterwave.ts";

type CapturedRequest = { url: string; init?: RequestInit };

function installProviderMock(captured: CapturedRequest[]) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    captured.push({ url, init });
    if (url.includes("/protocol/openid-connect/token")) {
      return Response.json({ access_token: "test-access-token", expires_in: 600 });
    }
    if (url.endsWith("/transfers/recipients")) {
      return Response.json({ status: "success", data: { id: "rcp_test" } }, { status: 201 });
    }
    if (url.endsWith("/transfers/rates")) {
      return Response.json({ status: "success", data: { id: "rte_test", source: { currency: "USD", amount: "1" }, destination: { currency: "KES", amount: "130" } } }, { status: 201 });
    }
    if (url.endsWith("/transfers")) {
      return Response.json({ status: "success", data: { id: "trf_test", status: "NEW" } }, { status: 201 });
    }
    return Response.json({ error: { type: "REQUEST_NOT_VALID", message: "unexpected request" } }, { status: 400 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function setTestCredentials() {
  Deno.env.set("FLW_CLIENT_ID", "client-id");
  Deno.env.set("FLW_CLIENT_SECRET", "client-secret");
  Deno.env.set("FLW_ENCRYPTION_KEY", "encryption-key");
  Deno.env.set("FLW_V4_ENVIRONMENT", "sandbox");
}

Deno.test("V4 Kenya bank recipient uses the documented recipient body", async () => {
  setTestCredentials();
  const captured: CapturedRequest[] = [];
  const restore = installProviderMock(captured);
  try {
    const result = await createKenyaRecipient({
      channel: "bank",
      firstName: "Amina",
      lastName: "Otieno",
      accountNumber: "1234567",
      bankCode: "01",
      reference: "bp-test-reference-001",
    });
    assert(result.ok);
    const request = captured.find((item) => item.url.endsWith("/transfers/recipients"))!;
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      type: "bank_kes",
      name: { first: "Amina", last: "Otieno" },
      bank: { account_number: "1234567", code: "01" },
    });
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-access-token");
    assert(headers.get("x-trace-id")!.length >= 12);
    assert(headers.get("x-idempotency-key")!.length >= 12);
    assert(!JSON.stringify(request).includes("client-secret"));
  } finally {
    restore();
  }
});

Deno.test("V4 Kenya mobile recipient uses network and digit-only msisdn", async () => {
  setTestCredentials();
  const captured: CapturedRequest[] = [];
  const restore = installProviderMock(captured);
  try {
    const result = await createKenyaRecipient({
      channel: "mobile_money",
      firstName: "Amina",
      lastName: "Otieno",
      accountNumber: "+254700000000",
      network: "MPESA",
      reference: "bp-test-reference-004",
    });
    assert(result.ok);
    const request = captured.find((item) => item.url.endsWith("/transfers/recipients"))!;
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      type: "mobile_money_kes",
      name: { first: "Amina", last: "Otieno" },
      mobile_money: { network: "MPESA", msisdn: "254700000000" },
    });
  } finally {
    restore();
  }
});

Deno.test("V4 transfer uses recipient ID and explicit amount semantics", async () => {
  setTestCredentials();
  const captured: CapturedRequest[] = [];
  const restore = installProviderMock(captured);
  try {
    const result = await createKenyaTransfer({
      recipientId: "rcp_test",
      sourceCurrency: "USD",
      amount: 5,
      appliesTo: "source_currency",
      reference: "bp-test-reference-002",
      narration: "Test payout",
      meta: { borderpay_user_id: "user-test" },
    });
    assert(result.ok);
    const request = captured.find((item) => item.url.endsWith("/transfers"))!;
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      action: "instant",
      reference: "bp-test-reference-002",
      narration: "Test payout",
      meta: { borderpay_user_id: "user-test" },
      payment_instruction: {
        recipient_id: "rcp_test",
        source_currency: "USD",
        amount: { value: 5, applies_to: "source_currency" },
      },
    });
  } finally {
    restore();
  }
});

Deno.test("V4 rate quote sends destination amount, not a legacy source amount", async () => {
  setTestCredentials();
  const captured: CapturedRequest[] = [];
  const restore = installProviderMock(captured);
  try {
    const result = await quoteKenyaDestinationAmount({ sourceCurrency: "USD", destinationAmount: 130, reference: "bp-test-reference-003" });
    assert(result.ok);
    const request = captured.find((item) => item.url.endsWith("/transfers/rates"))!;
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      source: { currency: "USD" },
      destination: { currency: "KES", amount: 130 },
    });
  } finally {
    restore();
  }
});

Deno.test("V4 webhook signature verifies HMAC-SHA256 over the raw body", async () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ webhook_id: "wbk_test", type: "transfer.disburse", timestamp: Date.now(), data: { id: "trf_test", status: "SUCCESSFUL" } });
  Deno.env.set("FLW_WEBHOOK_SECRET_HASH", secret);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  const headers = new Headers({ "flutterwave-signature": btoa(binary) });
  assert(await verifyFlutterwaveWebhookSignature(body, headers));
  assert.equal(await verifyFlutterwaveWebhookSignature(`${body} `, headers), false);
});
