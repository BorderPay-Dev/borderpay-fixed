import { BorderPayClient } from "../typescript/dist/index.js";

async function main() {
  const gatewayUrl = process.env.GATEWAY_URL;
  const apiKey = process.env.API_KEY;
  const mode = process.env.MODE || "sandbox";

  if (!gatewayUrl || !apiKey) {
    throw new Error("GATEWAY_URL and API_KEY are required");
  }

  const client = new BorderPayClient({ gatewayUrl, apiKey, mode });

  const health = await client.health();
  console.log("health:", health.data);

  // Example customer create (replace email/ref before running in real sandbox)
  const customer = await client.createCustomer(
    {
      account_type: "individual",
      email: "partner-user@example.com",
      country_code: "NG",
      full_name: "Partner User",
      borderpay_user_id: `partner_ref_${Date.now()}`,
    },
    `idem-customer-${Date.now()}`,
  );

  console.log("customer:", customer.data);
}

main().catch((e) => {
  console.error("demo failed", e);
  process.exit(1);
});
