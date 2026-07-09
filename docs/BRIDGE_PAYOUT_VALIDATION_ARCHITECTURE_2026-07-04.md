# Bridge Payout Validation Architecture (2026-07-04)

## Scope
Backend-only enforcement for crypto-to-crypto Bridge payouts in:
- `supabase/functions/bridge-transfer/index.ts`
- `supabase/functions/_shared/bridge-payout-validator.ts`

Objective:
- hard-stop dust/failure-prone requests before Bridge API execution,
- enforce the BorderPay developer fee model for crypto payouts,
- constrain live crypto payout rails to approved production pathways only.

## Enforced Policy
### Developer fee
- `developer_fee = 1.00 + 0.25%` of the requested destination amount.
- The client/request amount is treated as the intended recipient amount.
- The server grosses up the Bridge source amount so the recipient amount remains whole after Bridge deducts the developer fee.

### Post-fee minimum enforcement
- Net destination amount is computed before calling Bridge:
  - `net_destination_amount = requested_destination_amount`
  - `gross_amount = requested_destination_amount + developer_fee`
- Request is blocked unless net is greater than or equal to route minimum.

### Active crypto payout routes (hard allowlist)
- `USDC` on `BASE`
- `USDT` on `TRON`

All other crypto route combinations are blocked at middleware level.

### Absolute gross safety minimums
- Base/USDC: gross minimum `2.00` (ensures net `>= 1.00`)
- Tron/USDT: gross minimum `4.00` (ensures net `>= 3.00`)

## Integration Strategy
### New middleware module
- `BridgePayoutValidator` implemented in:
  - `supabase/functions/_shared/bridge-payout-validator.ts`

Exports:
- `BRIDGE_PAYOUT_DEVELOPER_FEE_USD` (`"1.00"`)
- `BRIDGE_PAYOUT_ORCHESTRATION_BPS` (`25`, meaning `0.25%`)
- `isCryptoToCryptoTransfer(body)`
- `validateBridgePayout(body)`
- `simulateBridgePayoutValidation(input)`

### bridge-transfer wiring
For stablecoin-to-stablecoin transfers:
1. Validate route (Base/USDC or Tron/USDT only).
2. Normalize chain/currency.
3. Normalize requested destination amount to exactly 2 decimals.
4. Compute developer fee and gross source amount.
5. Reject with explicit error codes when invalid:
   - `unsupported_crypto_route`
   - `dust_minimum_not_met`
   - `chain_mismatch`
   - `currency_mismatch`
6. On success, Bridge payload is executed with:
   - `source.amount = gross_amount`
   - `developer_fee: { flat_amount: developer_fee }`

For non-crypto rails:
- existing legacy percentage-fee behavior is preserved to avoid regression.

## Mathematical Proof (Micro-Payouts)
Given fee `F = 1.00 + 0.25%`:
- `gross = requested_destination_amount + F`
- `net = requested_destination_amount`

### Case A: requested destination = 0.50
- fee = `1.00 + 0.00125`, rounded to `1.00`
- gross = `1.50`
- Base requires net `>= 1.00` -> **reject**
- Tron requires net `>= 3.00` -> **reject**

### Case B: requested destination = 1.00
- fee = `1.00 + 0.0025`, rounded to `1.00`
- gross = `2.00`
- Base requires net `>= 1.00` -> **accept**
- Tron requires net `>= 3.00` -> **reject**

### Case C: requested destination = 50,000.00
- fee = `1.00 + 125.00 = 126.00`
- gross = `50,126.00`
- Base requires net `>= 1.00` -> **accept**
- Tron requires net `>= 3.00` -> **accept**

## Simulation Block
The validator exposes deterministic simulation:

```ts
simulateBridgePayoutValidation({ chain: "base", currency: "usdc", destination_amount: "0.50" }); // blocked
simulateBridgePayoutValidation({ chain: "base", currency: "usdc", destination_amount: "1.00" }); // accepted
simulateBridgePayoutValidation({ chain: "tron", currency: "usdt", destination_amount: "2.00" }); // blocked
simulateBridgePayoutValidation({ chain: "tron", currency: "usdt", destination_amount: "50000.00" }); // accepted
```

## Runtime Behavior Summary
- Crypto payouts now fail closed by default unless request exactly matches:
  - payment rail stablecoin -> stablecoin,
  - chain/currency match one approved route,
  - gross and post-fee minimum checks pass.
- Dust-prone transactions are blocked pre-provider.
- Bridge receives fee in precise string format, e.g. `"126.00"` for a `50000.00` destination payout.
