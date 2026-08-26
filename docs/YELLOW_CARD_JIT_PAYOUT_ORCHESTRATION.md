# Yellow Card customer-funded payout orchestration

BorderPay must not prefund Yellow Card payouts from company treasury. A customer payout can be enabled only after an end-to-end, idempotent just-in-time funding flow exists.

Required sequence:

1. Authenticate the customer and verify transaction authorization.
2. Atomically reserve the full customer debit (payout amount plus applicable fees) in the authoritative wallet ledger.
3. Create or obtain a Yellow Card funding instruction tied to the same immutable idempotency key and customer payout intent.
4. Transfer the reserved customer funds from that customer's Bridge custodial wallet to the Yellow Card-designated funding destination.
5. Wait for provider evidence that Yellow Card credited the corresponding funds. A submitted Bridge transfer is not sufficient.
6. Submit the Yellow Card payout using the same amount, beneficiary, corridor and idempotency lineage.
7. Reconcile terminal status from verified Yellow Card webhook evidence. Release or refund the reservation on a terminal pre-execution failure; never retry with a new idempotency key after an ambiguous timeout.

Fail-closed conditions include insufficient customer balance, unavailable funding instructions, mismatched amounts or currencies, missing provider credit, stale or invalid webhook evidence, and any unknown outcome.

The production payout endpoint remains locked because the repository does not yet contain an authoritative Yellow Card funding-instruction contract or the Bridge-to-Yellow-Card credit confirmation needed for steps 3–5. Enabling `YC_PRODUCTION_SEND_ENABLED` alone cannot bypass this blocker.
