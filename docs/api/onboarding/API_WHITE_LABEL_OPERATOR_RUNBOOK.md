# API Partner And White-Label Operator Runbook

This runbook covers partner tenant setup and white-label branding metadata. It does **not** certify live external-account payouts. External-account payout certification requires a real Bridge external account ID from a user or partner tenant.

## Production Boundary

- Bridge remains the source of truth for customers, wallets, virtual accounts, external accounts, and transfers.
- API tenants are BorderPay control-plane records for partner access, limits, keys, IP allowlists, and rollout monitoring.
- White-label branding metadata is operator-approved configuration. Do not let partners self-publish logos, domains, or colors directly into production.
- Provider names must not appear in partner-facing or end-user-facing flows.

## Tenant Drill Without External Accounts

Run this before any external-account money movement exists:

1. Create or update the tenant in Admin Panel → **API & White Label**.
2. Keep `default_mode=sandbox` until closed-beta signoff is complete.
3. Set a conservative `max_single_transfer_usd`.
4. Issue one API key and copy it once.
5. Add IP allowlist rows through `api-gateway-admin` if the partner has static IPs.
6. Run `scripts/api/run_tenant_golive_drill.sh` with `DRY_RUN=true`.
7. Save the generated evidence directory with the partner onboarding record.

The dry-run drill validates tenant shape, key auth, health checks, rollout metrics, and promotion intent. It does not validate Bridge external-account payout execution.

## External Account Certification Gate

Do not mark a tenant as live for fiat off-ramp until all are true:

- Bridge external account exists and has an `external_account_id`.
- The account belongs to the intended customer or approved counterparty.
- A non-production-value payout test has been submitted through `POST /transfers`.
- Webhook, transaction row, notification row, ledger projection, and email evidence are captured.
- Rollback is documented: disable `beta_access_enabled`, revoke API key, and stop payout route exposure.

## White-Label Branding Metadata

The Admin Panel stores the approved branding under `api_tenants.metadata.white_label`:

```json
{
  "enabled": true,
  "app_name": "Partner App",
  "logo_url": "https://...",
  "background_image_url": "https://...",
  "primary_color": "#C7FF00",
  "accent_color": "#C7FF00",
  "support_email": "support@example.com",
  "custom_domain": "app.partner.com"
}
```

Before runtime app theming is enabled, verify:

- Logo URL is HTTPS and stable.
- Custom domain DNS and TLS are controlled by the partner.
- Colors pass contrast checks on dark and light surfaces.
- App name does not imply a licensed bank, card issuer, or unsupported product.
- Partner support email is monitored.

## Operator Signoff

- Tenant created or updated.
- API key issued and delivered securely.
- Rollout metrics checked.
- White-label metadata reviewed.
- External account gate marked `blocked` until real Bridge account evidence exists.
