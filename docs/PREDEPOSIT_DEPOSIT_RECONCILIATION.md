# Signed deposit reconciliation

The worker reads verified Bridge virtual-account funds_received and payment_processed events independently of payment ingestion. It never updates provider accounts, transfers or balances.

## Activation
The default remains disabled. A release operator must set policy mode to observe or enforce and set config.deposit_reconciliation_enabled=true and config.deposit_reconciliation_start_at to an explicit UTC timestamp. Events received before that boundary are not scanned. Business invoice matching is supported; individual events are recorded as out_of_scope.

## Matching
Customer + virtual-account ID must identify exactly one local owner with exactly one owner column. Incoming fiat amounts use exact integer minor units. Stablecoin settlement events use receipt.initial_amount and the virtual account's fiat currency, never the converted wallet amount. Names are Unicode-normalized and whitespace-normalized, without fuzzy entity matching.

A match requires an approved invoice and exported payment instructions before the provider event time, unexpired approval, buyer and remitter equality, exact amount/currency, customer/account binding, and no newer revision at that time. GBP remains corporate B2B only. One invoice number can bind to one deposit; subsequent events for that deposit are idempotent. Conflicts and ambiguous candidates require review.

## Evidence and access
Bindings and observations are append-only, service-only tables. Authenticated compliance operators can list observations via admin_deposits and follow a matched invoice to its private RFI dossier. Merchant download refuses to issue payment instructions again for an already-bound invoice.

No provider RFI submission is automated by this change. An invoice match is evidence correlation, not a guarantee of settlement or provider acceptance.

## Verification
tests/predeposit-reconciliation.test.mjs exercises disabled mode, signed/unsigned events, original amount vs converted amount, duplicate events, invoice reuse, wrong customer/sender, ambiguous invoices, early/expired approvals, account owner ambiguity, scheduler dispatch without queued invoices, and access controls.
