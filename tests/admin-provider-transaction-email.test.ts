import { render } from "../supabase/functions/_shared/email-templates/admin/provider-transaction-event.ts";

function assertStringIncludes(value: string, expected: string) {
  if (!value.includes(expected)) throw new Error(`expected output to include ${expected}`);
}

Deno.test("operator provider transaction email renders correlated evidence", () => {
  const email = render({
    provider: "bridge",
    event_type: "transfer.updated",
    event_id: "evt_123",
    resource_id: "transfer_456",
    customer_id: "customer_789",
    user_id: "user_abc",
    amount: "5000.00",
    currency: "usd",
    state: "payment_processed",
    direction: "credit",
    occurred_at: "2026-08-20T12:00:00.000Z",
    admin_url: "https://admin.example.test/compliance",
  });
  assertStringIncludes(email.subject, "[TRANSACTION] BRIDGE");
  assertStringIncludes(email.text, "evt_123");
  assertStringIncludes(email.text, "transfer_456");
  assertStringIncludes(email.text, "customer_789");
  assertStringIncludes(email.text, "5000.00 USD");
  assertStringIncludes(email.html, "https://admin.example.test/compliance");
  if (email.text.includes("undefined")) throw new Error("email rendered an undefined value");
});
