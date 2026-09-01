Subject: BorderPay Africa — EEA SCA initial QA evidence package

Hello Bridge SCA Team,

Please find attached BorderPay Africa, Inc.'s completed initial QA evidence
package for our directly implemented EEA SCA controls.

The package covers:

- Bridge-authoritative EEA residency scope and non-EEA exclusion;
- sequential transaction PIN and authenticator-app factors;
- payment-linked authorization bound to amount, payee and idempotency key;
- the corrected single `initiation` object with
  `attestations.sca.outcome = sca_used`;
- enrollment and recovery restrictions;
- credential-free audit logging, five-year retention enforcement, monitoring
  and incident response; and
- controlled QA captures and automated test results.

We have not initiated a production SCA test because Bridge advised that testing
is not permitted before approval. Please review the initial package and confirm
the approved QA procedure. Once authorized, we will provide the production
recording, test transaction evidence and signed WORM retention receipt.

Implementation DRI and legal representative:
Mark Ikaba, Founder & CEO, BorderPay Africa, Inc.
markikaba@borderpayafrica.com

Kind regards,
Mark Ikaba
Founder & CEO
BorderPay Africa, Inc.
