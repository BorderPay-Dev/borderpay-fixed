-- Business team invite acceptance support.
-- The invite link carries a random token; only its SHA-256 hash is stored.

alter table public.business_team_members
  add column if not exists invite_token_hash text,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists accepted_at timestamptz;

create unique index if not exists btm_invite_token_hash_idx
  on public.business_team_members (invite_token_hash)
  where invite_token_hash is not null;

create index if not exists btm_invite_email_status_idx
  on public.business_team_members (invited_email, status);
