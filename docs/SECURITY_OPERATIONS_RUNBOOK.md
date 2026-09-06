# BorderPay Security Operations Runbook

## Current boundary

Application checks reduce account, database, and email abuse. They do not stop
Supabase from counting a request that already reached an Edge Function. A large
invocation attack therefore also requires Supabase gateway/support controls.

Never delete incident evidence merely to make a dashboard warning disappear.
Retain summarized timestamps, routes, status codes, source networks and user
agents before applying the documented retention policy.

## Initial configuration

1. Confirm which Google Cloud project owns each control:
   - shipped iOS/Android Firebase project: `borderpay-e1b55`
   - shipped Firebase project number: `741995539698`
   - direct web reCAPTCHA Enterprise project: `borderpay-rc1-audit`
2. In Google Cloud, enable the reCAPTCHA Enterprise API and billing for the
   direct web assessment project.
3. Create separate web keys for the customer app, admin, partner portal and
   affiliate portal. Restrict each key to its exact hostname.
4. Create a dedicated API key restricted to the reCAPTCHA Enterprise API, set
   a quota, and store it only in Supabase Edge Function secrets. Never use a
   browser key as the backend assessment credential.
5. In Firebase App Check, keep Play Integrity and App Attest in monitoring mode
   until updated mobile builds are broadly installed.

Required Edge configuration:

```text
RECAPTCHA_ENTERPRISE_PROJECT_ID=borderpay-rc1-audit
RECAPTCHA_ENTERPRISE_API_KEY=<restricted server credential>
RECAPTCHA_ENTERPRISE_SITE_KEY=<customer web public key>
RECAPTCHA_ALLOWED_HOSTNAMES=app.borderpayafrica.com
RECAPTCHA_MIN_SCORE=0.7
SIGNUP_CAPTCHA_REQUIRED=false
PARTNER_RECAPTCHA_ENTERPRISE_SITE_KEY=<partner portal public key>
PARTNER_INVITE_CAPTCHA_REQUIRED=false
FIREBASE_APP_CHECK_PROJECT_NUMBER=741995539698
FIREBASE_APP_CHECK_ALLOWED_APP_IDS=1:741995539698:android:42f7e96132f4c288f3b46b,1:741995539698:ios:01c0246dc46dc1f1f3b46b
FIREBASE_APP_CHECK_REQUIRED=false
SIGNUP_ENABLED=true
```

Required customer-web build configuration:

```text
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=<customer web public key>
```

Required partner-portal build configuration:

```text
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=<partner portal public key>
```

## Safe rollout

1. Deploy with both `*_REQUIRED` flags false.
2. Verify web requests contain an action-specific `SIGNUP` token and native
   requests contain `X-Firebase-AppCheck`.
3. Confirm assessment hostname, action and score distributions for at least one
   normal traffic cycle. Never log raw CAPTCHA or App Check tokens.
4. Release new iOS/Android builds containing the App Check plugin.
5. Enable web CAPTCHA enforcement only after production web verification.
   Enable partner invite enforcement separately with
   `PARTNER_INVITE_CAPTCHA_REQUIRED=true` after the portal smoke test.
6. Enable native App Check enforcement only after the minimum supported mobile
   versions have adopted the new builds. The signup endpoint accepts either a
   valid Enterprise assessment or a valid Firebase App Check token.

## Attack response

1. Set `SIGNUP_ENABLED=false` to stop account creation and database/email work.
   This does not stop Edge invocation billing.
2. Open a Supabase incident ticket with the function name, UTC window, request
   count, response distribution and retained source-network evidence. Request
   gateway-level rate limiting/blocking and an abuse-usage review.
3. Keep payment webhooks and authenticated money-movement functions online
   unless their signatures or credentials are compromised.
4. Rotate only affected credentials. Provider webhook/key rotation must be
   coordinated so legitimate callbacks are not dropped.
5. Restore signup only after the request rate is stable and both protection
   paths pass production smoke tests.

## GitHub and deployment controls

- Require pull requests and at least one approving review on `main`.
- Enforce protection for administrators; block force pushes and branch deletion.
- Require the security pipeline, CodeQL, build and release gates.
- Require a production-environment reviewer and restrict production deployments
  to `main`.
- Require organization 2FA/passkeys and remove inactive collaborators.
- Enable secret-scanning validity checks and non-provider patterns.
- Pin third-party Actions to immutable commit SHAs.
- Put the internal admin domain behind an identity-aware access proxy with MFA;
  CAPTCHA is not an admin authorization boundary.
