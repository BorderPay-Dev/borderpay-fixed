-- Admin panel RLS hardening (idempotent)
-- Purpose:
-- 1) Ensure admin control-plane tables are protected by explicit RLS policies.
-- 2) Enforce least-privilege table grants for authenticated users.
-- 3) Keep service_role operational for edge-function writes.

begin;

-- Keep helper function secure and deterministic for policy checks.
create or replace function public.is_borderpay_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_borderpay_admin() from public;
grant execute on function public.is_borderpay_admin() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- admin_users
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'admin_users'
  ) then
    execute 'alter table public.admin_users enable row level security';

    -- Least privilege: authenticated users can read only through RLS.
    execute 'revoke all on table public.admin_users from anon';
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.admin_users from authenticated';
    execute 'grant select on table public.admin_users to authenticated';

    execute 'drop policy if exists admin_users_self_select on public.admin_users';
    execute $pol$
      create policy admin_users_self_select
      on public.admin_users
      for select
      to authenticated
      using (user_id = auth.uid())
    $pol$;

    execute 'drop policy if exists admin_users_admin_select on public.admin_users';
    execute $pol$
      create policy admin_users_admin_select
      on public.admin_users
      for select
      to authenticated
      using (public.is_borderpay_admin())
    $pol$;

    execute 'drop policy if exists admin_users_service_role_all on public.admin_users';
    execute $pol$
      create policy admin_users_service_role_all
      on public.admin_users
      for all
      to service_role
      using (true)
      with check (true)
    $pol$;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- admin_alerts
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'admin_alerts'
  ) then
    execute 'alter table public.admin_alerts enable row level security';

    -- Least privilege: authenticated users read/update only through admin RLS.
    execute 'revoke all on table public.admin_alerts from anon';
    execute 'revoke insert, delete, truncate, references, trigger on table public.admin_alerts from authenticated';
    execute 'grant select, update on table public.admin_alerts to authenticated';

    execute 'drop policy if exists admin_alerts_admin_read on public.admin_alerts';
    execute $pol$
      create policy admin_alerts_admin_read
      on public.admin_alerts
      for select
      to authenticated
      using (public.is_borderpay_admin())
    $pol$;

    execute 'drop policy if exists admin_alerts_admin_update on public.admin_alerts';
    execute $pol$
      create policy admin_alerts_admin_update
      on public.admin_alerts
      for update
      to authenticated
      using (public.is_borderpay_admin())
      with check (public.is_borderpay_admin())
    $pol$;

    execute 'drop policy if exists admin_alerts_service_role_all on public.admin_alerts';
    execute $pol$
      create policy admin_alerts_service_role_all
      on public.admin_alerts
      for all
      to service_role
      using (true)
      with check (true)
    $pol$;
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- admin_action_audit (ensure explicit least privilege)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'admin_action_audit'
  ) then
    execute 'alter table public.admin_action_audit enable row level security';

    execute 'revoke all on table public.admin_action_audit from anon';
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.admin_action_audit from authenticated';
    execute 'grant select on table public.admin_action_audit to authenticated';

    execute 'drop policy if exists admin_action_audit_admin_read on public.admin_action_audit';
    execute $pol$
      create policy admin_action_audit_admin_read
      on public.admin_action_audit
      for select
      to authenticated
      using (public.is_borderpay_admin())
    $pol$;

    execute 'drop policy if exists admin_action_audit_service_role on public.admin_action_audit';
    execute $pol$
      create policy admin_action_audit_service_role
      on public.admin_action_audit
      for all
      to service_role
      using (true)
      with check (true)
    $pol$;
  end if;
end;
$$;

commit;
