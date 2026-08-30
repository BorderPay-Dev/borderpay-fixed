import { extractBridgeWebhookIdentity } from "../supabase/functions/_shared/providers/bridge-webhook-identity.ts";

Deno.test("signed Bridge customer webhook metadata maps to Yellow Card identity fields", () => {
  const evidence = extractBridgeWebhookIdentity([{
    event_id: "evt-customer-1",
    event_type: "customer.updated",
    payload: { event_object: {
      first_name: "Verified",
      last_name: "Customer",
      email: "verified@example.com",
      residential_address: {
        street_line_1: "1 Verified Road",
        city: "Nairobi",
        country: "KEN",
      },
    } },
  }]);
  if (evidence.values.name !== "Verified Customer") throw new Error("name was not mapped");
  if (evidence.values.email !== "verified@example.com") throw new Error("email was not mapped");
  if (evidence.values.country !== "KEN") throw new Error("country was not mapped");
  if (evidence.values.address !== "1 Verified Road, Nairobi") throw new Error("address was not mapped");
  if (evidence.values.idNumber || evidence.values.idType) throw new Error("missing document identity must remain absent");
  if (evidence.eventIds.join(",") !== "evt-customer-1") throw new Error("event provenance missing");
});

Deno.test("Bridge webhook identity extractor never invents absent metadata", () => {
  const evidence = extractBridgeWebhookIdentity([{
    event_id: "evt-kyc-1",
    event_type: "kyc_link.updated",
    payload: { event_object: { customer_id: "customer-id", kyc_status: "approved" } },
  }]);
  if (Object.keys(evidence.values).length !== 0) throw new Error("identity metadata was fabricated");
  if (evidence.eventIds[0] !== "evt-kyc-1") throw new Error("event evidence was not retained");
});
