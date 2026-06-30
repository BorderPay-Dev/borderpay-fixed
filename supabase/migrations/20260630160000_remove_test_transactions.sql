-- Remove synthetic/test transactions from production reporting surfaces.
-- Scope is intentionally narrow to avoid touching real customer flows.

begin;

-- 1) Remove transactions tied to known test-user email patterns.
do $$
declare
  has_user_id boolean;
  has_business_user_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'user_id'
  ) into has_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'business_user_id'
  ) into has_business_user_id;

  if has_user_id and has_business_user_id then
    execute $sql$
      with test_users as (
        select up.id
        from public.user_profiles up
        where lower(coalesce(up.email, '')) like 'test@%'
           or lower(coalesce(up.email, '')) like 'pentest.%'
           or lower(coalesce(up.email, '')) like '%@example.%'
      )
      delete from public.transactions t
      using test_users tu
      where t.user_id = tu.id
         or t.business_user_id = tu.id
    $sql$;
  elsif has_user_id then
    execute $sql$
      with test_users as (
        select up.id
        from public.user_profiles up
        where lower(coalesce(up.email, '')) like 'test@%'
           or lower(coalesce(up.email, '')) like 'pentest.%'
           or lower(coalesce(up.email, '')) like '%@example.%'
      )
      delete from public.transactions t
      using test_users tu
      where t.user_id = tu.id
    $sql$;
  end if;
end;
$$;

-- 2) Remove synthetic smoke/test transactions by marker fields, if present.
do $$
declare
  has_reference boolean;
  has_bridge_transfer_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'reference'
  ) into has_reference;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'bridge_transfer_id'
  ) into has_bridge_transfer_id;

  if has_reference then
    execute $sql$
      delete from public.transactions
      where lower(coalesce(reference, '')) like '%smoke_%'
         or lower(coalesce(reference, '')) like 'test_%'
         or lower(coalesce(reference, '')) like '%_test_%'
    $sql$;
  end if;

  if has_bridge_transfer_id then
    execute $sql$
      delete from public.transactions
      where lower(coalesce(bridge_transfer_id, '')) like '%smoke_%'
         or lower(coalesce(bridge_transfer_id, '')) like 'test_%'
         or lower(coalesce(bridge_transfer_id, '')) like '%_test_%'
    $sql$;
  end if;
end;
$$;

commit;
