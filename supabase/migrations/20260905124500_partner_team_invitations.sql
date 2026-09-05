begin;

create table if not exists public.partner_team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','compliance','developer','viewer')),
  status text not null default 'invited' check (status in ('invited','accepted','revoked')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint partner_team_invitations_email_format
    check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create unique index if not exists partner_team_one_open_invite_idx
  on public.partner_team_invitations (organization_id, lower(email))
  where status = 'invited';

create index if not exists partner_team_invites_email_status_idx
  on public.partner_team_invitations (lower(email), status, invited_at desc);

alter table public.partner_team_invitations enable row level security;
revoke all on table public.partner_team_invitations from anon, authenticated;
grant all on table public.partner_team_invitations to service_role;

drop policy if exists partner_team_invitations_service_role on public.partner_team_invitations;
create policy partner_team_invitations_service_role
  on public.partner_team_invitations for all to service_role
  using (true) with check (true);

commit;
