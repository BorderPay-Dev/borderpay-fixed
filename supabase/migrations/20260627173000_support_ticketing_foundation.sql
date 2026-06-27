-- Support ticketing foundation (app + website + admin shared backend).
-- GPT/AI handling is intentionally NOT included in this migration.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_email text,
  requester_account_type text not null default 'individual'
    check (requester_account_type in ('individual', 'business')),
  source text not null default 'app'
    check (source in ('app', 'website', 'admin')),
  issue_type text not null default 'general'
    check (issue_type in ('account_access', 'verification', 'wallet_balances', 'send_receive', 'general')),
  subject text not null,
  status text not null default 'open'
    check (status in ('open', 'pending_support', 'pending_user', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'agent', 'assistant', 'system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_requester_idx
  on public.support_tickets (requester_user_id, created_at desc);
create index if not exists support_tickets_status_idx
  on public.support_tickets (status, last_message_at desc);
create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at asc);
create index if not exists support_ticket_events_ticket_idx
  on public.support_ticket_events (ticket_id, created_at asc);

create or replace function public.touch_support_ticket_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_support_tickets_touch_updated_at on public.support_tickets;
create trigger trg_support_tickets_touch_updated_at
before update on public.support_tickets
for each row
execute function public.touch_support_ticket_updated_at();

create or replace function public.bump_support_ticket_last_message_at()
returns trigger
language plpgsql
as $$
begin
  update public.support_tickets
     set last_message_at = coalesce(new.created_at, now())
   where id = new.ticket_id;
  return new;
end;
$$;

drop trigger if exists trg_support_messages_bump_ticket on public.support_ticket_messages;
create trigger trg_support_messages_bump_ticket
after insert on public.support_ticket_messages
for each row
execute function public.bump_support_ticket_last_message_at();

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;

drop policy if exists support_tickets_owner_read on public.support_tickets;
create policy support_tickets_owner_read
  on public.support_tickets
  for select to authenticated
  using (requester_user_id = auth.uid());

drop policy if exists support_tickets_owner_insert on public.support_tickets;
create policy support_tickets_owner_insert
  on public.support_tickets
  for insert to authenticated
  with check (requester_user_id = auth.uid());

drop policy if exists support_tickets_owner_update on public.support_tickets;
create policy support_tickets_owner_update
  on public.support_tickets
  for update to authenticated
  using (requester_user_id = auth.uid())
  with check (requester_user_id = auth.uid());

drop policy if exists support_tickets_admin_read on public.support_tickets;
create policy support_tickets_admin_read
  on public.support_tickets
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists support_tickets_admin_update on public.support_tickets;
create policy support_tickets_admin_update
  on public.support_tickets
  for update to authenticated
  using (public.is_borderpay_admin())
  with check (public.is_borderpay_admin());

drop policy if exists support_tickets_service_role_all on public.support_tickets;
create policy support_tickets_service_role_all
  on public.support_tickets
  for all to service_role
  using (true)
  with check (true);

drop policy if exists support_ticket_messages_owner_read on public.support_ticket_messages;
create policy support_ticket_messages_owner_read
  on public.support_ticket_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.support_tickets t
      where t.id = support_ticket_messages.ticket_id
        and t.requester_user_id = auth.uid()
    )
  );

drop policy if exists support_ticket_messages_owner_insert on public.support_ticket_messages;
create policy support_ticket_messages_owner_insert
  on public.support_ticket_messages
  for insert to authenticated
  with check (
    sender_type = 'user'
    and coalesce(is_internal, false) = false
    and sender_user_id = auth.uid()
    and exists (
      select 1
      from public.support_tickets t
      where t.id = support_ticket_messages.ticket_id
        and t.requester_user_id = auth.uid()
    )
  );

drop policy if exists support_ticket_messages_admin_read on public.support_ticket_messages;
create policy support_ticket_messages_admin_read
  on public.support_ticket_messages
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists support_ticket_messages_admin_insert on public.support_ticket_messages;
create policy support_ticket_messages_admin_insert
  on public.support_ticket_messages
  for insert to authenticated
  with check (public.is_borderpay_admin());

drop policy if exists support_ticket_messages_service_role_all on public.support_ticket_messages;
create policy support_ticket_messages_service_role_all
  on public.support_ticket_messages
  for all to service_role
  using (true)
  with check (true);

drop policy if exists support_ticket_events_owner_read on public.support_ticket_events;
create policy support_ticket_events_owner_read
  on public.support_ticket_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.support_tickets t
      where t.id = support_ticket_events.ticket_id
        and t.requester_user_id = auth.uid()
    )
  );

drop policy if exists support_ticket_events_admin_read on public.support_ticket_events;
create policy support_ticket_events_admin_read
  on public.support_ticket_events
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists support_ticket_events_admin_insert on public.support_ticket_events;
create policy support_ticket_events_admin_insert
  on public.support_ticket_events
  for insert to authenticated
  with check (public.is_borderpay_admin());

drop policy if exists support_ticket_events_service_role_all on public.support_ticket_events;
create policy support_ticket_events_service_role_all
  on public.support_ticket_events
  for all to service_role
  using (true)
  with check (true);

