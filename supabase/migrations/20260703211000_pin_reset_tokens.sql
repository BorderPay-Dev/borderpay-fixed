-- One-time PIN reset tokens (email-link flow)
create table if not exists public.pin_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  email_snapshot text,
  requested_by_admin uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pin_reset_tokens_user_idx
  on public.pin_reset_tokens(user_id, created_at desc);

create index if not exists pin_reset_tokens_hash_idx
  on public.pin_reset_tokens(token_hash);

alter table public.pin_reset_tokens enable row level security;

drop policy if exists pin_reset_tokens_service_role on public.pin_reset_tokens;
create policy pin_reset_tokens_service_role on public.pin_reset_tokens
  for all to service_role using (true) with check (true);

