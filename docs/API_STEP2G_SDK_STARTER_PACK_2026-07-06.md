# API Step 2G: SDK Starter Pack (2026-07-06)

Delivered starter artifacts aligned to BorderPay API v1.0.1.

## Delivered

1. TypeScript SDK starter
- `docs/api/sdk/typescript/package.json`
- `docs/api/sdk/typescript/tsconfig.json`
- `docs/api/sdk/typescript/src/types.ts`
- `docs/api/sdk/typescript/src/client.ts`
- `docs/api/sdk/typescript/src/webhook.ts`
- `docs/api/sdk/typescript/src/index.ts`
- `docs/api/sdk/typescript/README.md`

2. Example apps
- `docs/api/sdk/examples/node-sandbox-demo.mjs`
- `docs/api/sdk/examples/webhook-verifier-demo.mjs`

## Coverage

- Client methods:
  - health
  - createCustomer
  - createWallet
  - createVirtualAccount
  - createTransfer
  - createPayout
  - createWebhook

- Webhook helper:
  - HMAC SHA-256 verification
  - timestamp tolerance window
  - constant-time signature compare

## Constraints

- Starter only; not published to npm.
- Error handling normalized to gateway contract.
- Uses API key bearer against `public-api-gateway`.

## Next (2H)

- Publish versioned package strategy:
  - internal npm package naming
  - semantic versioning and changelog policy
  - CI contract tests generated from OpenAPI
