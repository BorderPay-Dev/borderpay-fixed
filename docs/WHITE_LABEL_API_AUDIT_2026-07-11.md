# White Label / API Marketplace Audit - 2026-07-11

## Current State

BorderPay has an API marketplace foundation, not a full white-label app builder.

Implemented:

- Tenant model: `api_tenants`
- Scoped API keys: `api_keys`
- IP allowlists: `api_ip_allowlist`
- Webhook endpoint registry: `api_webhook_endpoints`
- Request logging: `api_request_log`
- Rate-limit counters
- Idempotency replay store
- Closed-beta production allowlist
- Per-tenant transfer cap
- Admin edge function: `api-gateway-admin`
- Public edge function: `public-api-gateway`
- OpenAPI, Postman, curl cookbook, SDK starter, onboarding runbooks
- Rollout watchdog and emergency rollback scripts

## Fixed In This Audit

- Public transfer/payout validation now rejects legacy `stablecoin` rails and requires Bridge-compatible rails.
- Transfer/payout requests now require `on_behalf_of`.
- Bridge wallet transfers now require `source.bridge_wallet_id`.
- Blockchain destinations now require `destination.to_address` or `destination.address`.
- Virtual-account requests now align to `destination.payment_rail` and `destination.bridge_wallet_id` or address.
- Virtual-account developer fee is computed server-side from provider settings/fallback, not from partner payloads.
- Public and admin webhook endpoint registration now requires HTTPS.
- OpenAPI, Postman, curl cookbook, and webhook mocks were updated to v1.0.2 contract examples.

## Remaining Before External Launch

- Deploy patched `public-api-gateway` and `api-gateway-admin`.
- Run one live closed-beta tenant drill with a real sandbox API key.
- Create a dedicated first partner tenant.
- Issue scoped sandbox key only.
- Add partner IP allowlist.
- Register partner webhook endpoint.
- Execute health, wallet, VA, transfer, payout, webhook tests.
- Confirm webhook delivery and idempotency replay evidence.
- Keep production API closed-beta until legal/compliance sign-off.

## Not Yet Implemented

- Self-service developer dashboard.
- Tenant billing/subscription automation.
- White-label branded app/domain provisioning.
- Partner-facing API key management UI.
- Partner webhook event delivery worker beyond endpoint registration.
- Public pricing page for API marketplace.

## Launch Position

The API marketplace is beta-ready after deployment and tenant drill. The white-label product is not ready as a standalone product; it needs a separate scope for tenant branding, custom domains, billing, and partner admin UI.
