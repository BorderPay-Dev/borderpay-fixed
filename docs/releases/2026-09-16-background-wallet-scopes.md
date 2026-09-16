# Background wallet region recovery

Production evidence: an approved individual had the correct canonical customer and provider country, but the country observation expired on September 13. Installed clients start scope refresh and RLS reads concurrently. Wallet visibility therefore cannot depend exclusively on opening a screen.

The regional financial-read guard now uses the shared regional resolver. Businesses use their stored incorporation country. Existing wallet-read release control and fresh EEA access authorization are preserved. Payout SCA is separate and unchanged.

`refresh-wallet-scopes` is service-authenticated and consumes atomic database leases for up to 20 approved individuals per run. It reads their current profile from Bridge via the canonical identity invariant, publishes the existing one-hour observation, and renews before expiry. Failures retry after five minutes; dead workers' leases expire. Provider and cache errors never extend the old observation. The worker does not create wallets or transfer funds.

Apply migrations `20260916100000`, `20260916110000`, and `20260916111000` in order after `20260916090000`. The production operator has already applied the regional financial-read guard. The scheduler uses a server-held service-role credential from Vault or the existing worker configuration. It only sends to the fixed production Supabase project and is not callable by app users. Run `select public.invoke_wallet_scope_refresh()` after installing the scheduler and inspect the pg_net response. Monitor expired/missing scopes and `wallet_scope_refresh_jobs.last_error`; increase processing capacity if backlog is not draining before renewal deadlines.

Validation: executable SQL tests for regional reads, EEA access protection, claim eligibility, lease exclusion/recovery, and changed customer IDs. HTTP worker tests verify service authorization, actual provider-derived cache writes, EEA/non-EEA scope, and failure retries. Local scheduler validation uses stubbed HTTP/cron functions; production execution must still be confirmed.
