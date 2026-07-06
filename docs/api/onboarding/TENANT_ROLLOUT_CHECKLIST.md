# BorderPay API Tenant Rollout Checklist (Closed Beta)

Run this checklist top-to-bottom. Do not skip steps.

## A) Intake & Approval

- [ ] Partner intake form completed (`PARTNER_INTAKE_TEMPLATE.md`)
- [ ] Compliance approval recorded
- [ ] Engineering approval recorded
- [ ] Approved cap values set (`max_single_transfer_usd`, `rate_limit_per_minute`)

## B) Tenant Configuration

- [ ] Tenant exists in `api_tenants`
- [ ] `default_mode` set correctly (`sandbox` or `production`)
- [ ] `beta_access_enabled` set to `false` initially
- [ ] `max_single_transfer_usd` configured
- [ ] Rate limit configured (`rate_limit_per_minute`)
- [ ] API key created with least-privilege scopes
- [ ] API key delivered securely

## C) Network & Webhooks

- [ ] Partner static IP/CIDR allowlist added
- [ ] Webhook endpoint created
- [ ] Webhook secret delivered securely
- [ ] Webhook signature verification confirmed by partner

## D) Preflight Gate Checks

- [ ] Production health probe returns `forbidden` before allowlist
- [ ] Sandbox health probe returns `success=true`
- [ ] Idempotency replay check passes
- [ ] Idempotency mismatch check returns `idempotency_replay_mismatch`

## E) Promotion

- [ ] `beta_access_enabled=true` set using admin function
- [ ] Production health probe returns `success=true`
- [ ] Smoke transfer in sandbox completed

## F) Postflight Monitoring

- [ ] Request/error logs visible in first 30 minutes
- [ ] Webhook delivery confirmed end-to-end
- [ ] No provider-leak fields in partner payloads
- [ ] Rollback owner assigned

## G) Evidence Pack

- [ ] Preflight blocked response captured
- [ ] Promotion API response captured
- [ ] Postflight successful health response captured
- [ ] Rollout evidence stored using `ROLLOUT_EVIDENCE_TEMPLATE.md`

