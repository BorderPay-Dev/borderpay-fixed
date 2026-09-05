begin;

create table if not exists public.affiliate_sso_nonces (
  jti uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint affiliate_sso_nonce_expiry check (expires_at > issued_at)
);

create index if not exists affiliate_sso_nonces_user_idx
  on public.affiliate_sso_nonces (user_id, issued_at desc);

alter table public.affiliate_sso_nonces enable row level security;
revoke all on table public.affiliate_sso_nonces from anon, authenticated;
grant all on table public.affiliate_sso_nonces to service_role;

drop policy if exists affiliate_sso_nonces_service_role on public.affiliate_sso_nonces;
create policy affiliate_sso_nonces_service_role
  on public.affiliate_sso_nonces for all to service_role
  using (true) with check (true);

commit;
