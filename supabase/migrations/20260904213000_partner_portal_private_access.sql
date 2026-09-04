-- Make partner access explicitly operator-approved. Public requests are only
-- intake records; they never create Auth identities or organizations.

begin;

alter table public.partner_access_invite_requests
  add column if not exists status text not null default 'pending',
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'partner_access_invite_status_check'
      and conrelid = 'public.partner_access_invite_requests'::regclass
  ) then
    alter table public.partner_access_invite_requests
      add constraint partner_access_invite_status_check
      check (status in ('pending','invited','accepted','rejected'));
  end if;
end $$;

create index if not exists partner_access_invite_status_time_idx
  on public.partner_access_invite_requests (status, requested_at desc);

-- A partner identity belongs to one active partner organization. This also
-- keeps the Edge Function's membership lookup unambiguous.
create unique index if not exists partner_members_one_active_org_per_user_idx
  on public.partner_members (user_id)
  where is_active = true;

-- Suspension is an explicit operator decision supported by the review worker.
alter table public.partner_applications
  drop constraint if exists partner_applications_status_check;
alter table public.partner_applications
  add constraint partner_applications_status_check
  check (status in ('draft','submitted','under_review','more_information','approved','rejected','withdrawn','suspended'));

commit;
