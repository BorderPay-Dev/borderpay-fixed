# BorderPay SDK Starter (TypeScript)

Starter SDK generated for Step 2G, aligned to `docs/api/openapi-v1.yaml` (`v1.0.1`).

## Structure

- `src/client.ts`: typed client for gateway endpoints
- `src/webhook.ts`: webhook signature verification helper
- `src/types.ts`: request/response types
- `src/index.ts`: public exports

## Build

```bash
cd docs/api/sdk/typescript
npm install
npm run build
```

## Use in Node demo

```bash
cd docs/api/sdk/typescript
npm install
npm run build

cd ../examples
GATEWAY_URL="https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/public-api-gateway" \
API_KEY="<plain_api_key>" \
MODE="sandbox" \
node node-sandbox-demo.mjs
```

## Client quick start

```ts
import { BorderPayClient } from "./dist/index.js";

const client = new BorderPayClient({
  gatewayUrl: "https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/public-api-gateway",
  apiKey: "<plain_api_key>",
  mode: "sandbox",
});

const health = await client.health();
```

## Webhook verification quick start

Expected header pattern:
- `x-borderpay-signature: sha256=<hex>`
- `x-borderpay-timestamp: <unix_seconds>`

```ts
import { verifyBorderPayWebhook } from "./dist/index.js";

const result = await verifyBorderPayWebhook({
  rawBody,
  timestamp: req.headers["x-borderpay-timestamp"],
  signatureHeader: req.headers["x-borderpay-signature"],
  signingSecret: process.env.BORDERPAY_WEBHOOK_SECRET!,
});
```

## Notes

- This is a starter SDK, not an officially versioned npm package yet.
- Expand endpoint coverage as new routes are promoted from gateway.
