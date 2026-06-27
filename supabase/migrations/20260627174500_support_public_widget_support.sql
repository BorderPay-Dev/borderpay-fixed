-- Enable public website support tickets (no signed-in user required).

alter table public.support_tickets
  alter column requester_user_id drop not null;

alter table public.support_tickets
  add column if not exists requester_name text;

drop policy if exists support_tickets_owner_insert on public.support_tickets;
create policy support_tickets_owner_insert
  on public.support_tickets
  for insert to authenticated
  with check (
    (
      requester_user_id = auth.uid()
      and source in ('app', 'admin')
    )
    or (
      requester_user_id is null
      and source = 'website'
      and requester_email is not null
    )
  );

