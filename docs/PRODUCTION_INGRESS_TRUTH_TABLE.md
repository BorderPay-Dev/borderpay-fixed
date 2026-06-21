# Production Ingress Truth Table

## Event Type -> Parse/Route Truth Contract

| Bridge Event Pattern | Parse Expectation | Signature/Replay Expectation | Dedupe Expectation | Routing Decision (Shadow) | Failure Result |
|---|---|---|---|---|---|
| `customer.created` | JSON object with `id`, `type`, `event_object` | signature must pass, replay window must pass | first seen => `new`; repeat => `duplicate` | `bridge.customer` | malformed/signature/replay => reject |
| `customer.updated` | same as above | same | same | `bridge.customer` | same |
| `customer.deleted` | same as above | same | same | `bridge.customer` | same |
| `kyc_link.created` | object includes `event_object` w/ customer linkage | same | same | `bridge.kyc` | same |
| `kyc_link.updated` | same | same | same | `bridge.kyc` | same |
| `kyc_link.deleted` | same | same | same | `bridge.kyc` | same |
| `virtual_account.activity.created` | object contains VA identifiers, amount/currency for activity events | same | same | `bridge.virtual_account` | same |
| `virtual_account.*` other | lifecycle payload parse succeeds even if partial fields | same | same | `bridge.virtual_account` | same |
| `wallet.*` | wallet id + customer id expected in `event_object` fallbacks | same | same | `bridge.wallet` | same |
| `bridge_wallet.*` | same as wallet | same | same | `bridge.wallet` | same |
| `external_account.created` | external account id and customer id expected | same | same | `bridge.external_account` | same |
| `external_account.updated` | same | same | same | `bridge.external_account` | same |
| `external_account.deleted` | same | same | same | `bridge.external_account` | same |
| `transfer.created` | transfer identifiers + state may be partial | same | same | `bridge.transfer` | same |
| `transfer.processed` | transfer state expected resolvable by mapper | same | same | `bridge.transfer` | same |
| `transfer.failed` | transfer state may map to failed | same | same | `bridge.transfer` | same |
| `payout.*` | accepted into transfer-domain route | same | same | `bridge.transfer` | same |
| `deposit.*` | accepted into transfer-domain route | same | same | `bridge.transfer` | same |
| unknown `*` | parse best-effort with fallback event id | signature/replay still enforced | same | `bridge.unknown` | reject only on signature/replay/parse hard fail |

## Failure Case Matrix

| Condition | Logged in `ingress_shadow_log` | HTTP | Queue Write |
|---|---|---|---|
| Missing/malformed signature header | `signature_ok=false`, `parse_ok` maybe true, reason=`signature_header_invalid` | 401 | no |
| Signature verification failure | `signature_ok=false`, reason=`signature_verify_failed` | 401 | no |
| Replay window expired | `replay_window_ok=false`, reason=`replay_window_exceeded` | 400 | no |
| Invalid JSON body | `parse_ok=false`, reason=`invalid_json` | 400 | no |
| Duplicate event id | `dedupe_decision=duplicate` | 200 | no (shadow mode) |
| Valid new event | `signature_ok=true`, `parse_ok=true`, `dedupe_decision=new`, routing set | 200 | no (shadow mode) |

## Determinism Requirements

1. Same raw request + same signature header => same `dedupe_decision` and `routing_decision`.
2. Same `event_id` replayed N times => first `new`, all subsequent `duplicate`.
3. Unknown event types must never bypass signature/replay enforcement.
4. Failure reasons must be stable and machine-parseable.

## Validation Queries (design targets)

- Shadow writes only:
  - `count(*) from ingress_shadow_log where received_at > t0`
- Queue isolation:
  - `count(*) from pending_events where source='bridge' and created_at > t0 and origin='shadow'` => 0 (or equivalent tagging proof)
- Deterministic replay:
  - group by `event_id_raw` with expected one `new`, N `duplicate`

