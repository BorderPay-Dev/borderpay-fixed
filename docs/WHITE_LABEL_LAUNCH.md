# White-label customer app release

The partner portal now saves a draft. A saved draft is not a live customer app.
The service-owned `white_label_releases` row is authoritative; legacy branding
metadata cannot publish a customer app. The retired `white-label-branding`
endpoint returns 410 and does not create tenants or overwrite settings.

## Release order

1. Apply `supabase/migrations/20260917180000_white_label_releases.sql` using the
   Supabase SQL editor or the normal migration runner. It adds release, history
   and legal-acceptance tables; it does not activate any tenant.
2. Deploy the changed Edge functions: white-label-config, white-label-branding,
   partner-onboarding, auth-signup, auth-resend-verification, auth-reset-password,
   verify-email-token, bridge-kyc-link, bridge-kyb-link, send-email,
   public-api-gateway. Keep existing endpoint JWT settings; white-label-config
   is public and verifies optional customer bearer tokens itself.
3. Build and deploy the customer app and partner portal from reviewed commits.
   Use one release per Vercel project. Do not retry quota-blocked deployments
   repeatedly or assume failed Git integrations retry automatically.
4. Provision the approved partner organization/project/tenant through the existing
   operator approval workflow. Commercial and product approvals remain required.
   Production customer access must be separately approved: `default_mode=production`
   and `metadata.production_access=true`. Sandbox API activation is insufficient.
   A pilot uses the real customer backend, with signup limited to invited emails.
   Explicitly approve its onboarding account types in tenant onboarding policy.
   No default policy is silently enabled by a branding save.
5. Partner saves name, legal entity, logo, accent, support email/page, app origin,
   Privacy/Terms URLs and their document version in the portal, then requests
   launch review. Use an accent readable with black button text. Uploaded logo
   paths are versioned; a new logo cannot replace a published asset in place.
6. Operator adds the customer's domain to the reviewed customer-app Vercel
   project, configures DNS/TLS and the exact origin in Supabase Auth redirects.
   Add the domain to the existing Google reCAPTCHA Enterprise site's allowed
   domains. The backend accepts validated CAPTCHA tokens only from approved,
   published partner domains or existing first-party hostnames.
7. Partner sets `_borderpay.<customer app hostname>` TXT to
   `borderpay-verification=<domain_challenge>` shown in the portal.
8. Copy `scripts/white-label/launch-evidence.example.json`. Record actual approval
   references, deployment ID, and explicit `pilot_emails`. With Node 24 and
   operator environment credentials `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN`:

   ```sh
   node scripts/white-label/publish.mjs --tenant TENANT_UUID --project PROJECT_REF --evidence launch-evidence.json --pilot
   node scripts/white-label/publish.mjs --tenant TENANT_UUID --project PROJECT_REF --evidence launch-evidence.json --pilot --publish
   ```

   Without `--publish` the command is read-only. Pilot publication checks domain
   ownership, Vercel project/artifact, working HTTPS links, Auth redirects and
   documented commercial/legal/rollback/CAPTCHA readiness. Pilot signup accepts
   only listed emails. It never initiates payments, sends invites or approves KYB.
9. Run the acceptance journey below. Record evidence references, then repeat the
   command without `--pilot`, first read-only and then with `--publish`.
   Public signup must not open until those results are reviewed.

## Acceptance journey

- Open partner origin in a fresh browser and on mobile web/PWA. Logo, accent,
  name, support, legal links and install identity must match before and after login.
- Sign up with each approved account type. Confirm email, resume external ToS
  and KYC/KYB, and recover password. Every return must use the same app origin.
- Verify immutable `account_origin_provenance` and its authorization/legal record.
  Attempt another tenant's account on this app: the signed-in runtime must reject
  it. Confirm existing API/RLS ownership checks still reject foreign resources.
- Verify approved customer provisioning, regional wallet visibility, saved bank
  and crypto destinations, balances, receipts and reconciliation. EEA/non-EEA
  country rules and SCA remain controlled by existing financial backend logic.
- Use separately authorized pilot transfers for enabled rails and reconcile
  webhook success/refund evidence. Never substitute a UI toast for ledger proof.
- Verify inbox rendering/delivery and links for verification, approval, payment,
  refund and recovery. Email rendering is derived from recorded tenant ownership;
  callers cannot choose another brand by supplying a tenant ID.
- Exercise support links, downtime/config errors, stale draft versus published
  settings, sign-out, expired sessions and rollback.

## Rollback

Operator can suspend only the affected release using:

```sql
update public.white_label_releases
set status = 'suspended', updated_at = now()
where tenant_id = 'REPLACE_WITH_TENANT_UUID'::uuid;
```

Retain account origin, financial history and legal evidence. Do not delete users,
wallets or transfers. To restore a prior brand, copy the reviewed historical
snapshot into `draft` and rerun domain/publication checks. Release history records
publication/status changes. Existing logged-in financial authorization remains
under the core account/freeze/SCA controls; release suspension is a customer-app
availability control, not a replacement for financial account suspension.

## Current certification limit

Code and mock tests are not production acceptance. A real partner domain, approved
entity/project, brand/legal assets and a controlled customer cohort are required.
Seven days is a target after those inputs and approvals are complete, not a
promise of external DNS, KYB or app-store approval timing. This change targets
partner web/PWA delivery; it does not create partner-branded native store builds.

## Integration release, 18 September

The customer API now delegates provisioning, saved destinations and payments to the core customer endpoints; see `docs/api/PARTNER_INTEGRATION.md`. The release preserves the separately deployed founder treasury and business-name transliteration changes. Production backup comparison found the legacy `verify-email-token` still attempting eager Bridge customer creation; this release uses the hosted verification flow to collect ToS and identity details and retains email confirmation/redirect behavior. A missing Bridge ID before hosted verification is not treated as completed KYC.
