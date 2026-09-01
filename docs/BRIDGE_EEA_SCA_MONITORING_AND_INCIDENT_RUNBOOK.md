# Bridge EEA SCA monitoring and incident runbook

Owner: BorderPay Security and Compliance

Bridge incident address: `sca-incidents@bridge.xyz`

## Automated monitoring

The `sca-monitoring` worker runs every five minutes and evaluates the previous fifteen minutes of credential-free `sca_audit_events`. Alerts are deduplicated by time bucket, pseudonymous user identifier, and signal type. Operator delivery uses BorderPay's logged transactional-email path.

| Signal | Trigger | Severity |
|---|---:|---|
| Failed authentication pattern | 5 or more failed SCA attempts for one user in 15 minutes | High |
| Authentication lockout | Any server-enforced SCA lockout | Critical |
| Authorization replay or mismatch | 3 or more rejected/consumed/mismatched authorizations in 15 minutes | Critical |
| Provider scope unavailable | Any failure to establish authoritative Bridge EEA scope | High |
| Recovery restriction | Any protected action attempted during credential recovery | Medium |

Secrets, PINs, TOTP values/seeds, passwords, biometric templates, private keys, and raw transfer payloads are excluded from audit rows and notification bodies.

## Operator response

1. Acknowledge the alert in the compliance case system.
2. Confirm whether an in-scope Bridge custodial wallet and EEA legal entity are involved.
3. Freeze protected actions if compromise, bypass, or an unauthorized transaction is suspected.
4. Preserve relevant credential-free audit events and external signed receipts.
5. Contact the customer through verified channels without requesting PINs, passwords, or authenticator codes.
6. Escalate to the named incident owner and legal representative.

## Bridge reporting deadlines

- Notify Bridge within 24 hours of detecting a suspected or confirmed credential compromise, SCA bypass, unauthorized transaction, or material SCA availability incident.
- Submit a detailed report within 72 hours.
- Provide weekly updates until closure.
- Notify Bridge of a material SCA architecture, vendor, factor, EEA-scope, DRI, or recovery-flow change within 10 business days.
- Notify Bridge at least 45 calendar days before introducing a new SCA vendor.
- Submit quarterly attestations within 15 business days after quarter-end.

## Incident report minimum contents

- detected and reported timestamps;
- severity and affected protected action;
- pseudonymised customer and Bridge transaction identifiers;
- event sequence and relevant authorization hashes;
- containment and customer-protection actions;
- confirmed or suspected root cause;
- transaction impact;
- remediation owner and deadlines; and
- closure evidence.
