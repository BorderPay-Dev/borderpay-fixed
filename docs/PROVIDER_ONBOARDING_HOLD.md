# New-account provider hold — 24 September 2026

New registrations remain BorderPay accounts with no banking-provider customer ID. Keep `BRIDGE_ONBOARDING_ENABLED=false` in production. Email verification and profile creation remain available. Do not enable customer provisioning or hosted KYC/KYB until the next provider has an approved implementation.

The customer, KYC and KYB endpoints and operator missing-customer repair all enforce the hold. Partner API verification uses the same KYC/KYB endpoints. The provider adapter also rejects direct customer creation while disabled. Existing transfers, balances, virtual accounts, restrictions and event processing are unchanged; this hold does not alter existing provider customer IDs or approvals.

Do not swap an API key to migrate customers. Provider selection and future activation require a separate implementation. No new provider is enabled by this change.

Runtime verification: all four provisioning endpoints return `bridge_onboarding_paused` before provider traffic. Unit verification: disabled/missing/invalid onboarding configuration attempts zero outbound requests. Signup continues to store null provider customer IDs.
