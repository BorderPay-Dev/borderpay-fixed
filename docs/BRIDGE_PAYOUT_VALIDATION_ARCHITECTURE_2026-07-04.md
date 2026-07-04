# Bridge Payout Validation Architecture (2026-07-04)

## Scope
Backend-only enforcement for crypto-to-crypto Bridge payouts in:
- `supabase/functions/bridge-transfer/index.ts`
- `supabase/functions/_shared/bridge-payout-validator.ts`

Objective:
- hard-stop dust/failure-prone requests before Bridge API execution,
- enforce a single flat BorderPay developer fee model for crypto payouts,
- constrain live crypto payout rails to approved production pathways only.

## Enforced Policy
### Flat developer fee
- `developer_fee = "1.00"` USD (string, exactly 2 decimals) for crypto payouts.

### Post-fee minimum enforcement
- Net destination amount is computed before calling Bridge:
  - `net_destination_amount = gross_amount - 1.00`
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
- `isCryptoToCryptoTransfer(body)`
- `validateBridgePayout(body)`
- `simulateBridgePayoutValidation(input)`

### bridge-transfer wiring
For stablecoin-to-stablecoin transfers:
1. Validate route (Base/USDC or Tron/USDT only).
2. Normalize chain/currency.
3. Normalize gross amount to exactly 2 decimals.
4. Compute net amount after fee.
5. Reject with explicit error codes when invalid:
   - `unsupported_crypto_route`
   - `gross_below_minimum`
   - `dust_minimum_not_met`
   - `chain_mismatch`
   - `currency_mismatch`
6. On success, Bridge payload is executed with:
   - `developer_fee: { flat_amount: "1.00" }`

For non-crypto rails:
- existing legacy percentage-fee behavior is preserved to avoid regression.

## Mathematical Proof (Micro-Payouts)
Given fee `F = 1.00`:
- `net = gross - F`

### Case A: gross = 1.50
- net = `1.50 - 1.00 = 0.50`
- Base requires net `>= 1.00` -> **reject**
- Tron requires net `>= 3.00` -> **reject**

### Case B: gross = 2.00
- net = `2.00 - 1.00 = 1.00`
- Base requires net `>= 1.00` -> **accept**
- Tron requires gross `>= 4.00` and net `>= 3.00` -> **reject**

### Case C: gross = 5.00
- net = `5.00 - 1.00 = 4.00`
- Base requires net `>= 1.00` -> **accept**
- Tron requires net `>= 3.00` -> **accept**

## Simulation Block
The validator exposes deterministic simulation:

```ts
simulateBridgePayoutValidation({ chain: "base", currency: "usdc", gross_amount: "1.50" }); // blocked
simulateBridgePayoutValidation({ chain: "base", currency: "usdc", gross_amount: "2.00" }); // accepted
simulateBridgePayoutValidation({ chain: "tron", currency: "usdt", gross_amount: "2.00" }); // blocked
simulateBridgePayoutValidation({ chain: "tron", currency: "usdt", gross_amount: "5.00" }); // accepted
```

## Runtime Behavior Summary
- Crypto payouts now fail closed by default unless request exactly matches:
  - payment rail stablecoin -> stablecoin,
  - chain/currency match one approved route,
  - gross and post-fee minimum checks pass.
- Dust-prone transactions are blocked pre-provider.
- Bridge receives fee in precise string format (`"1.00"`).
