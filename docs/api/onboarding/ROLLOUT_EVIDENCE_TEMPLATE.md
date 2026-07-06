# BorderPay API Rollout Evidence Template

Fill this after each tenant promotion event.

## Rollout Metadata

- Tenant ID:
- Tenant name:
- Operator:
- Change request ID:
- Rollout timestamp (UTC):
- Rollback owner:

## Control Values Applied

- `default_mode`:
- `beta_access_enabled`:
- `max_single_transfer_usd`:
- `rate_limit_per_minute`:
- Allowlisted CIDRs:

## Preflight Evidence

- Production preflight blocked (`forbidden`) payload:
```json
{}
```

- Sandbox health success payload:
```json
{}
```

## Promotion Evidence

- `upsert_tenant` request payload:
```json
{}
```

- `upsert_tenant` response payload:
```json
{}
```

## Postflight Evidence

- Production health success payload:
```json
{}
```

- Idempotency replay response:
```json
{}
```

- Idempotency mismatch response:
```json
{}
```

## Signoff

- Compliance signoff:
- Engineering signoff:
- Ops signoff:
- Final status:
  - `approved`
  - `rolled_back`

