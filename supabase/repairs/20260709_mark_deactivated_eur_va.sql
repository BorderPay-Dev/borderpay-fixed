-- Mark the stale local projection for a Bridge-deactivated EUR virtual account.
-- Bridge VA id supplied from the production Bridge dashboard on 2026-07-09.
update public.bridge_virtual_accounts
set
  status = 'closed',
  updated_at = now()
where bridge_virtual_account_id = 'c4309673-678f-4906-8e0c-72b7f60dcc9a';
