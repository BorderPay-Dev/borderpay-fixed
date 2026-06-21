# Ingress Security and Replay Analysis

## Core Threat Model

Ingress is the trust boundary. If signature/replay/parse logic is wrong, downstream correctness is irrelevant.

## Replay Attack Behavior

### Expected defenses

1. Signed timestamp is mandatory.
2. Replay window enforced (current: 10 minutes).
3. Duplicate `event_id` idempotently classified.
4. Replays outside window rejected even if signature is valid.

### Attack cases

1. Captured valid webhook replayed within window
- Outcome: first accepted as `new`, repeats marked `duplicate`.
- Risk: low if dedupe stable.

2. Captured valid webhook replayed after window
- Outcome: rejected by replay window.
- Risk: low.

3. Modified body with old signature
- Outcome: signature check fails.
- Risk: low.

4. Header tampering (`t`/`v0` malformed)
- Outcome: malformed-header reject.
- Risk: low.

## Signature Edge Cases

1. Timestamp parsing ambiguity
- Must use raw timestamp string for signed payload construction and numeric timestamp only for time-window arithmetic.

2. Base64 normalization variants
- URL-safe/base64 variants must normalize deterministically.

3. Double-hash verification compatibility
- Keep exact provider-compatible verification behavior to avoid false rejects.

4. Missing key/invalid key format
- Fail closed; log explicit key-load failure reason.

## Timing Windows

Current replay window: 10 minutes.

Risk tradeoff:
- too short => false rejects under network delays
- too long => wider replay surface

Recommendation:
- Keep 10-minute baseline.
- Log observed request age distribution in shadow mode before any change.

## Malformed Payload Resilience

### Required behavior

- invalid JSON => 400
- structurally valid JSON with missing optional fields => parse_ok true, routing may be `bridge.unknown`
- structurally valid but semantically partial => do not crash, classify and log

### Resilience principles

1. Never crash handler on missing nested keys.
2. Always emit classification record in shadow log unless raw body unreadable.
3. Use bounded error messages (avoid log poisoning).

## Deterministic Failure Semantics

Failure classes must be mutually exclusive and stable:
- `signature_header_invalid`
- `signature_verify_failed`
- `replay_window_exceeded`
- `invalid_json`
- `duplicate_event`
- `accepted_new_event`

## Security Controls Required for Shadow Layer

1. Shadow mode is opt-in, env-gated.
2. Emergency kill switch available at runtime.
3. No queue writes in `shadow_only`.
4. No financial table writes from ingress code path.
5. Access to shadow logs restricted to ops/admin roles.

## Residual Risks

1. Operational misuse: enabling `shadow_only` too broadly can pause normal processing.
- Mitigation: require explicit mode + event filter + timeboxed enablement.

2. False confidence if only synthetic-like payloads are tested.
- Mitigation: capture real Bridge ingress diversity in mirror-observe windows.

3. Log growth/PII exposure in shadow logs.
- Mitigation: retention policy + field minimization + encryption-at-rest assumptions.

## Go/No-Go Criteria Before Hardening

No permission hardening until all pass:
1. Signature decision parity (normal vs shadow classification) PASS
2. Replay determinism PASS
3. Malformed payload resilience PASS
4. Zero queue writes in `shadow_only` PASS
5. Zero financial side effects PASS

