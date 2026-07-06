# BorderPay API Partner Intake Template

Use this template before issuing production API access.

## 1) Partner Identity

- Legal entity name:
- Operating brand:
- Country of registration:
- Company registration number:
- Tax/VAT number:
- Primary compliance contact (name + email):
- Primary technical contact (name + email):
- 24/7 incident contact (name + email + phone):

## 2) Use Case Scope

- Primary use case:
  - `payouts`
  - `collections`
  - `wallet orchestration`
  - `other`
- Product type:
  - `marketplace`
  - `payroll platform`
  - `fintech app`
  - `enterprise treasury`
  - `other`
- Expected monthly transfer count:
- Expected monthly gross volume (USD):
- Max expected single transfer (USD):

## 3) Integration Scope (v1)

- Required API groups:
  - `customers`
  - `wallets`
  - `virtual-accounts`
  - `transfers/payouts`
  - `webhooks`
- Required mode at onboarding:
  - `sandbox only`
  - `production closed-beta`
- Requested go-live date (UTC):

## 4) Security & Runtime Controls

- Static egress IPs for allowlist (CIDR list):
- Webhook endpoint URL(s):
- Webhook retry handling implemented:
  - `yes`
  - `no`
- Idempotency implemented on client side:
  - `yes`
  - `no`
- API key custody owner (team/person):
- Incident response SLA accepted:
  - `yes`
  - `no`

## 5) Compliance Confirmation

- Restricted-jurisdiction filter implemented:
  - `yes`
  - `no`
- Sanctions screening in partner flow:
  - `yes`
  - `no`
- Data retention policy accepted:
  - `yes`
  - `no`
- Terms/API policy accepted:
  - `yes`
  - `no`

## 6) BorderPay Approval

- Tenant owner (BorderPay):
- Compliance approver:
- Engineering approver:
- Risk level:
  - `low`
  - `medium`
  - `high`
- Approved `max_single_transfer_usd`:
- Approved `rate_limit_per_minute`:
- Closed-beta approval:
  - `approved`
  - `rejected`

