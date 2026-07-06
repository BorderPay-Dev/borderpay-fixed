# API Step 2J: Closed-Beta Guardrails (2026-07-06)

This step adds hard runtime controls for production API beta rollout.

## Delivered

1. Tenant rollout controls in schema
- Migration: `supabase/migrations/20260706171000_api_gateway_closed_beta_controls.sql`
- New tenant fields:
  - `beta_access_enabled boolean not null default false`
  - `max_single_transfer_usd numeric(18,2) null`

2. Gateway runtime enforcement
- File: `supabase/functions/public-api-gateway/index.ts`
- Rules:
  - If `API_V1_CLOSED_BETA` is enabled (default `true`) and tenant is in `production` mode, request is blocked unless `beta_access_enabled=true`.
  - For `POST /v1/transfers` and `POST /v1/payouts`, if `max_single_transfer_usd` is configured and request amount exceeds cap, request is blocked.

3. Context/runtime wiring
- File: `supabase/functions/_shared/api-gateway.ts`
- `resolveGatewayContext` now returns:
  - `betaAccessEnabled`
  - `maxSingleTransferUsd`

4. Admin control surface
- File: `supabase/functions/api-gateway-admin/index.ts`
- `list_tenants` and `upsert_tenant` now expose/manage:
  - `beta_access_enabled`
  - `max_single_transfer_usd`

## Why this matters

Without these controls, production API rollout can bypass explicit allowlisting and move unbounded volume before FINTRAC gating is complete.
