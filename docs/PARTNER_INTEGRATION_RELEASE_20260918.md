# Partner integration production release — 18 September 2026

## Deployed artifacts

- Customer app: `dpl_2H8QsjUs1qd6zRSvcuoT41QUZeLb`, production, Ready; `https://app.borderpayafrica.com`; bundle `index-CMKscRkT.js`; source `364b5e9e`.
- Partner portal: `dpl_CCbCnQvjUM5NZsEiUunAJNGYsRo4`, production, Ready; `https://portal.borderpayafrica.com`; bundle `index-c3nTf1Ex.js`; source `18a5877`.
- Two local Vercel production deployments. No mobile release was built.
- Applied `20260917180000_white_label_releases.sql` after rollback validation and anonymous/authenticated access assertions.

## Edge deployment readback

| Function | Version | Status |
|---|---:|---|
| auth-signup | 444 | ACTIVE |
| auth-reset-password | 404 | ACTIVE |
| auth-resend-verification | 315 | ACTIVE |
| verify-email-token | 309 | ACTIVE |
| bridge-kyc-link | 337 | ACTIVE |
| bridge-kyb-link | 360 | ACTIVE |
| send-email | 438 | ACTIVE |
| public-api-gateway | 261 | ACTIVE |
| white-label-branding | 242 | ACTIVE |
| partner-onboarding | 47 | ACTIVE |
| white-label-config | 1 | ACTIVE |

All listed functions use in-function authorization with platform JWT verification disabled, as configured in this release. `verify-email-token` is protected by the single-use verification token and now follows the repository's public-auth configuration; the previous deployed version had platform JWT validation enabled. Customer financial endpoints and their JWT settings were not redeployed or changed.

## Validation

- Customer app and portal production builds passed.
- Deployment gate passed (`PREDEPLOY_GATE_REPORT_20260918T121538Z.md`).
- 14 customer API/white-label runtime tests and 13 existing SCA/verification/transfer regression tests passed.
- Partner workspace audit: 27/27. SDK build and customer-header/GET/DELETE conformance passed.
- Portal onboarding browser tests passed at mobile and desktop widths.
- Live production app and portal returned HTTP 200 and rendered on a 390px browser without JavaScript exceptions.
- Unpublished white-label origin: 404; retired branding endpoint: 410; gateway without partner credentials: 401.
- Partner webhook cron remains active.

## Not yet certified

Production currently has zero active partner tenants, customer memberships and published white-label releases. No partner was activated and no money was moved by this release. Global API financial release controls remain closed pending a controlled pilot; sandbox requests cannot use this backend's production Bridge environment.

The first pilot needs an approved partner/project, customer domain, brand/legal/support assets and an independently configured sandbox backend if sandbox testing is required. Follow `WHITE_LABEL_LAUNCH.md` and `api/PARTNER_INTEGRATION.md`. Before public launch, record actual hosted onboarding, authorized payment, signed webhook delivery, duplicate/retry behavior, final status/refund and tenant-isolation evidence. Build success does not replace those results.

## Read-only SQL verification

```sql
select jsonb_build_object(
  'active_partner_tenants', (select count(*) from public.api_tenants where is_active),
  'partner_customer_memberships', (select count(*) from public.api_tenant_end_users),
  'white_label_releases', (select count(*) from public.white_label_releases),
  'webhook_worker_active', (select bool_or(active) from cron.job where jobname = 'api-partner-webhook-drain')
) as partner_release_state;
```
