# BorderPay Business API Fee Model (Draft for Approval)

## Non-negotiable runtime transfer rule
- Outbound transfer platform fee remains fixed at **$1.00 USD** per transfer.
- Applied uniformly in backend validation for supported crypto payout routes.

## Pricing packages (API access)

### 1) Starter API
- Monthly platform fee: **$49**
- Included volume: **up to 500 transfers/month**
- Overage: **$0.20 per transfer**
- Webhook retry window: standard
- Support SLA: business-hours

### 2) Growth API
- Monthly platform fee: **$299**
- Included volume: **up to 5,000 transfers/month**
- Overage: **$0.12 per transfer**
- Higher rate limits + priority webhook retries
- Support SLA: priority business-hours

### 3) Enterprise / White Label
- Monthly platform fee: **custom (from $2,000)**
- Included volume: negotiated
- Overage: negotiated
- Dedicated limits, custom webhook endpoints, white-label options
- Support SLA: dedicated channel

## What customers pay per transfer (clear statement)
- Platform transfer fee: **$1.00 flat**
- Network/provider costs: passed through per route policy where applicable
- Any corridor markup (if enabled): explicit and disclosed in quote

## Guardrails
- No hidden fees
- No dynamic transfer fee tiers in runtime
- Any future fee change requires:
  1. policy doc update,
  2. customer notice,
  3. backend + admin fee manager consistency check

## Decision required before public pricing page
- Confirm Starter/Growth monthly numbers above
- Confirm whether overage is billed monthly postpaid or wallet-deducted
- Confirm free trial window (recommended: 14 days, no transfer credits)
