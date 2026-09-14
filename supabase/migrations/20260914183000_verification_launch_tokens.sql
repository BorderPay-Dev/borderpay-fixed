create table if not exists public.verification_launch_tokens (
  token uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_url text not null check (target_url like 'https://%'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists verification_launch_tokens_expiry_idx
  on public.verification_launch_tokens (expires_at);

alter table public.verification_launch_tokens enable row level security;
revoke all on public.verification_launch_tokens from anon, authenticated;

drop policy if exists verification_launch_tokens_service on public.verification_launch_tokens;
create policy verification_launch_tokens_service
on public.verification_launch_tokens for all to service_role
using (true) with check (true);
