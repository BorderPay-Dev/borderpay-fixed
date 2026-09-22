# Paused receiving access
A raw Bridge paused state with no local hold opens a limited wallet workspace. The historical full-screen hold remains for fraud, local restrictions, unknown states and old clients without the raw provider state.

The workspace exposes only recorded regional wallet balances and transaction history. Receive, bank details and wallet deposit addresses stay locked. Send explains support-led fund recovery; it does not submit direct transfers. Direct payout APIs continue to enforce PIN/SCA and now explicitly reject provider-paused accounts before provider mutations.

The authenticated paused_account_wallet_summary RPC returns only the caller's balances and held VA currencies, never account numbers or deposit addresses. It retains financial-read authentication and regional asset checks. Frozen accounts receive no financial payload.

A new customer.updated.status_transitioned event with paused status sends the existing account_suspended template with receiving-specific copy. Explicit locally recorded fraud holds get sender-bank fraud-report resolution instructions. Other local holds retain generic restricted-account copy. Recipient and hold state come from current database records, not webhook contact details; sender deduplication prevents replay mail.

No historical webhook replay, customer campaign, payout, provider account reactivation or automatic fraud release is part of this change. No-Fraud confirmation requires review and formal release. Bridge's full recovery guide and feature enablement remain prerequisites for any recovery transfer implementation.

Deployment order: summary RPC and payout guard, web workspace, email templates, then worker. Existing installed native bundles keep their old screen until a later approved build. Store listing metadata is unchanged.
