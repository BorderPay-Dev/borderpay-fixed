-- The external-account function supports Bridge GB accounts, but the original
-- local projection constraints predated that route and rejected GB/GBP rows.
-- Expand only the descriptor mirror constraints; no account or balance data is
-- rewritten.

alter table public.bridge_external_accounts
  drop constraint if exists bridge_external_accounts_account_type_check;

alter table public.bridge_external_accounts
  add constraint bridge_external_accounts_account_type_check
  check (account_type in ('us', 'iban', 'gb'));

alter table public.bridge_external_accounts
  drop constraint if exists bridge_external_accounts_currency_check;

alter table public.bridge_external_accounts
  add constraint bridge_external_accounts_currency_check
  check (currency in ('USD', 'EUR', 'GBP'));
