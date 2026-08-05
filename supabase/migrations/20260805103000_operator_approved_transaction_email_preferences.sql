create table if not exists public.admin_notification_preferences (
  admin_user_id uuid primary key references auth.users(id) on delete cascade,
  transaction_notification_email text not null,
  approved_transaction_emails boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_notification_email_valid check (
    transaction_notification_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

alter table public.admin_notification_preferences enable row level security;
revoke all on table public.admin_notification_preferences from anon;
grant select, insert, update on table public.admin_notification_preferences to authenticated;

drop policy if exists admin_notification_preferences_self_select on public.admin_notification_preferences;
create policy admin_notification_preferences_self_select
  on public.admin_notification_preferences for select to authenticated
  using (auth.uid() = admin_user_id and public.is_borderpay_admin());

drop policy if exists admin_notification_preferences_self_insert on public.admin_notification_preferences;
create policy admin_notification_preferences_self_insert
  on public.admin_notification_preferences for insert to authenticated
  with check (auth.uid() = admin_user_id and public.is_borderpay_admin());

drop policy if exists admin_notification_preferences_self_update on public.admin_notification_preferences;
create policy admin_notification_preferences_self_update
  on public.admin_notification_preferences for update to authenticated
  using (auth.uid() = admin_user_id and public.is_borderpay_admin())
  with check (auth.uid() = admin_user_id and public.is_borderpay_admin());

drop policy if exists admin_notification_preferences_service_role_all on public.admin_notification_preferences;
create policy admin_notification_preferences_service_role_all
  on public.admin_notification_preferences for all to service_role
  using (true) with check (true);

drop trigger if exists trg_admin_notification_preferences_touch on public.admin_notification_preferences;
create trigger trg_admin_notification_preferences_touch
  before update on public.admin_notification_preferences
  for each row execute function public.touch_updated_at();

comment on table public.admin_notification_preferences is
  'Per-operator email preferences. Approved transaction alerts are opt-in and provider-confirmed only.';
