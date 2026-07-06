# BorderPay API Cutover Signoff Rubric

All items must be `PASS` before final approval.

## Technical Gate

- [ ] RC gate dry run passed.
- [ ] Controlled promotion RC gate passed (or explicitly deferred).
- [ ] Postflight watchdog clear.
- [ ] No unresolved `forbidden`/`unauthorized` anomalies for promoted tenants.
- [ ] Rollback command tested in non-destructive mode.

## Compliance Gate

- [ ] Partner intake completed for each promoted tenant.
- [ ] Allowed use cases confirmed.
- [ ] Jurisdiction/restriction checks confirmed.
- [ ] Incident contact path validated.

## Operations Gate

- [ ] On-call owner assigned.
- [ ] Evidence bundle attached to change request.
- [ ] Secrets checklist completed.
- [ ] Rollback owner assigned and reachable.

## Final Decision

- Engineering: `PASS` / `FAIL`
- Compliance: `PASS` / `FAIL`
- Operations: `PASS` / `FAIL`

If any section is `FAIL`, cutover is not approved.
