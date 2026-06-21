# Bridge Webhook Matrix

Date: 2026-06-20
Scope: Bridge webhook categories vs BorderPay handler coverage.

Legend:

- Implemented
- Partially Implemented
- Missing
- Ignored by Design
- Deprecated

## Matrix

| Bridge Category | Bridge Mutation Types | BorderPay Status | Notes |
|---|---|---|---|
| `customer` | `created`, `updated`, `updated.status_transitioned`, `deleted` | Partially Implemented | `customer.*` routed; behavior currently focused on status/contact projection. |
| `kyc_link` | `created`, `updated`, `updated.status_transitioned` | Implemented | Routed to KYC/KYB handler; status projection exists. |
| `transfer` | `created`, `updated`, `updated.status_transitioned` | Partially Implemented | Handler exists; state mapping incomplete vs latest Bridge states. |
| `virtual_account.activity` | `created`, `updated` | Partially Implemented | `virtual_account.*` routing likely catches this family; needs explicit taxonomy lock to avoid drift. |
| `bridge_wallet.activity` | `created`, `updated` | Missing | Router checks `wallet.*`, not explicit `bridge_wallet.activity.*`. |
| `liquidation_address.drain` | `created`, `updated`, `updated.status_transitioned` | Ignored by Design | Out of current BorderPay scope; must remain safely ignored/logged. |
| `static_memo.activity` | `created`, `updated` | Ignored by Design | Out of current BorderPay scope. |
| `external_account` | `created`, `updated` | Ignored by Design | Not in active BorderPay core flow currently. |
| `card_account` | `created`, `updated`, `updated.status_transitioned` | Ignored by Design | Cards not in current production scope. |
| `card_transaction` | `created`, `updated`, `updated.status_transitioned` | Ignored by Design | Cards not in current production scope. |
| `posted_card_account_transaction` | `created` | Ignored by Design | Cards not in current production scope. |
| `card_withdrawal` | `created`, `updated`, `updated.status_transitioned` | Ignored by Design | Cards not in current production scope. |

## Required for BorderPay core money movement

Required now:

- `customer`
- `kyc_link`
- `transfer`
- `virtual_account.activity`
- `bridge_wallet.activity`

Optional/deferred:

- all card categories
- liquidation address drain
- static memo activity
- external_account (unless product explicitly enables that flow)

## Compliance/robustness requirements

1. Unknown categories/events must be persisted + completed safely (already present).
2. Required categories must have explicit, tested handler mapping.
3. `bridge_wallet.activity` must not rely on ambiguous prefix assumptions.
4. Webhook mapping should be generated from a single canonical registry to prevent drift.

