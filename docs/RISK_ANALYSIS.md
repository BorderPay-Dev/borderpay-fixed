# Risk Analysis — Financial Test Isolation Boundary

## Executive Summary

Current highest risk is **behavioral testing without isolation**. Running live-path tests on real users would create silent financial state contamination.

Recommended risk treatment: implement Synthetic Event Mode first.

## Top Risks and Controls

1. Risk: Real customer financial mutation during testing
- Severity: Critical
- Likelihood (without isolation): High
- Impact: incorrect balances, ledger drift, reconciliation noise, customer-visible inconsistencies
- Control:
  - route tests only through `pending_events.source='bridge_test'`
  - hard-block financial table writes for synthetic source
- Residual risk after control: Low

2. Risk: Synthetic events pollute production queue and mask real incidents
- Severity: High
- Likelihood: Medium
- Impact: operator confusion, false alarms, delayed triage
- Control:
  - strict event ID prefixes (`test:` / `bridge_test:`)
  - source-level dashboards/queries filtered by `source`
  - synthetic report artifacts generated per run
- Residual risk: Low

3. Risk: Replay tests appear to pass while idempotency is not truly exercised
- Severity: High
- Likelihood: Medium
- Impact: false confidence before permission hardening
- Control:
  - deterministic event IDs in replay suites
  - explicit duplicate-ingest assertions at both webhook and queue identities
  - verify no duplicate completion summaries for same replay key
- Residual risk: Medium-Low

4. Risk: Failure-mode path diverges from production behavior
- Severity: High
- Likelihood: Medium
- Impact: retry/terminal semantics unvalidated for true runtime path
- Control:
  - reuse same `fail_pending_event` / claim / reap functions
  - synthetic mode only changes side-effect target, not retry state machine
- Residual risk: Low

5. Risk: Team treats synthetic success as full real-money proof
- Severity: High
- Likelihood: Medium
- Impact: premature release confidence
- Control:
  - explicit gate language: synthetic mode proves runtime behavior, not Bridge settlement economics
  - require separate approved strategy for real-money canary before final launch claim
- Residual risk: Medium

## Constraint Stress-Test

Weak assumption to avoid: "If invariants pass, behavioral correctness is proven."
- Counterpoint: invariants are snapshots; they do not prove active path correctness under replay/failure pressure.
- Mitigation: synthetic event activation with strict tagging and retry/replay proofs.

Weak assumption to avoid: "Canary principal is always safer than synthetic mode."
- Counterpoint: canary still writes financial projections unless all downstream exclusions are guaranteed.
- Mitigation: synthetic-first, then canary only after explicit aggregate/reconciliation exclusion controls.

## Rollout Risk Rating

- Before isolation boundary: **High**
- After synthetic boundary + audits: **Medium-Low**
- After later canary domain (optional phase): **Low**

## Recommended Go/No-Go Rule

No move to permission hardening until all are true:
- synthetic replay safety report PASS
- synthetic failure-mode report PASS
- synthetic flow execution report PASS
- proof of zero financial table writes for synthetic runs PASS

