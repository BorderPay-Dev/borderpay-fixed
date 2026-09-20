# Partner customer API integration

The API gateway routes customer operations through BorderPay's existing financial backend. Use a partner API key on your server and an authenticated **end-customer** Supabase session in `X-BorderPay-Customer-Authorization: Bearer <access_token>`. The session must belong to an immutable `api_tenant_end_users` membership for that partner. An operator's session cannot substitute for customer consent. Never embed partner API keys in a web/mobile application.

Gateway URL: `https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/public-api-gateway`.
Send the logical route in `x-borderpay-route`, the environment in `x-borderpay-mode`, and a JSON `method` field when using POST transport. Direct GET paths with query parameters are also accepted. Create/update/delete operations require a stable `Idempotency-Key` (8–64 printable non-space characters for payments). Retry uncertain payment responses with the same key and unchanged financial payload. Authentication credentials and SCA authorization IDs do not change that payment identity. Failed authorization responses are not cached as successful payment results.

## Onboarding and ownership

1. After operator product/commercial approval, create an API credential with the required scopes and configure the partner egress IP allowlist.
2. Create a one-time `/v1/onboarding-authorizations` token for the partner's external user identifier and approved account type. This step uses the partner key without a customer session.
3. Complete the existing BorderPay hosted signup/authentication flow using that token. It creates immutable tenant/customer membership. Do not create an unrelated Supabase user or pass arbitrary user IDs to claim an account.
4. The customer authenticates; your server forwards their access token in the separate customer header. `/v1/customers` reads their linked identity. POST `/v1/customers` or `/v1/verification-links` resumes their hosted KYC/KYB and ToS. Customer identity fields come from the signup/verified profile, not partner-supplied overrides.
5. Approved customer provisioning uses the normal regional policy. POST `/v1/wallets` ensures the requested supported wallet and reuses an existing chain wallet. EEA: Base with USDC/EURC. Non-EEA: USDC/Base and USDT/Tron.

## Routes and scopes

| Route | Method | Scope | Payload |
|---|---|---|---|
| `/v1/customers` | GET / POST | `customers:read` / `customers:write` | Optional matching customer_id |
| `/v1/verification-links` | POST | `onboarding:write` | `{}` |
| `/v1/wallets` | GET / POST | `wallets:read` / `wallets:write` | POST: symbol, chain |
| `/v1/balances` | GET | `wallets:read` | `{}`; live balances of visible selected wallets |
| `/v1/virtual-accounts` | GET / POST | `virtual_accounts:read` / `virtual_accounts:write` | POST: currency USD/EUR/GBP; BorderPay selects settlement |
| `/v1/external-accounts` | GET / POST / DELETE | `external_accounts:read` / `external_accounts:write` | POST: account in customer-app US/IBAN/GB format; DELETE: external_account_id |
| `/v1/external-wallets` | GET / POST / DELETE | `wallets:read` / `wallets:write` | POST: label, asset, chain, address; DELETE: id |
| `/v1/beneficiary-authorizations` | POST | `external_accounts:write` | request, pin, totp; request is `{action:"create",account}` or `{action:"delete",external_account_id}` |
| `/v1/payment-authorizations` | POST | `transfers:write` | request, pin, totp; use the payment's Idempotency-Key |
| `/v1/transfers` | GET / POST | `transfers:read` / `transfers:write` | GET: optional transfer_id, limit ≤100, after=next_cursor; POST: payment below |
| `/v1/payouts` | POST | `payouts:write` | Same payment contract; core validates saved bank/crypto destination |
| `/v1/webhooks` | POST | `webhooks:write` | endpoint_url; copy signing secret once |

Read lists are customer scoped, not a dump of all partner customers. Transfer pagination uses an opaque resource UUID cursor; do not infer chronological order from the cursor. The customer financial-read policy applies to balance/wallet/VA access.

## EURC/Base withdrawal example

Save the external wallet first, then use its ID and address:

```json
{
  "source": {"payment_rail":"bridge_wallet","currency":"EURC","amount":"150.00","bridge_wallet_id":"CUSTOMER_BASE_WALLET"},
  "destination": {"payment_rail":"base","currency":"EURC","external_wallet_id":"SAVED_WALLET_ID","address":"SAVED_ADDRESS"}
}
```

For EEA, send that exact object as `request` to `/v1/payment-authorizations`, with the customer's PIN and current TOTP and the intended payment's Idempotency-Key. Then POST it to `/v1/transfers` with returned `sca_authorization_id` and the **same** Idempotency-Key. Amount, asset, wallet, destination and tenant are bound by the canonical core payload hash. Authorization expires and is single-use. Do not synthesize `sca_used`; Bridge initiation evidence comes from the core transfer endpoint only after successful factor verification.

For non-EEA API payouts, include `transaction_pin` in the payment request. TOTP is not required. Existing first-party/white-label customer-app biometric choices remain unchanged; this server API does not accept an unverified `biometric:true` flag.

Fiat payouts use a saved `external_account_id`, the matching bank payment rail/currency, and USDC or USDT funding as supported by the core. Other-customer custodial destinations must already be registered to this same partner; arbitrary Bridge wallet IDs are rejected.

An approved USD stablecoin transfer cap is required on the tenant. EURC uses the separately approved `api_tenants.metadata.max_single_transfer_eur` decimal-string cap, never an unconverted comparison to USD. Only operators should configure approved caps.

## Environments and release controls

Provider environment, actual Bridge URL and tenant mode must agree for customer routes, including reads and onboarding. A sandbox header does not switch credentials. This deployment's production provider must not serve sandbox customer operations. Use an independently configured sandbox backend/provider credential before enabling sandbox writes. Health/webhook configuration alone is not a financial sandbox.

Production APIs remain gated by product approval, tenant activation, beta allowlist, configured provider/money-movement controls and transfer limits. White-label publication is separately controlled by a verified domain and approved release. Do not bypass either workflow to test.

## Acceptance evidence

Local integration fixtures verify identity isolation, canonical SCA payloads, UK incorporation/PIN behavior, frozen-account denial, core error propagation and environment isolation. A partner pilot must additionally complete hosted onboarding, an explicitly authorized payment, signed webhook verification, duplicate/retry handling, final status and refund reconciliation. No live payment is implied by the presence of the SDK or a successful build.
