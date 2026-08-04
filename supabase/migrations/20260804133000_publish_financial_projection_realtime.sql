-- Publish confirmed financial projection changes so the authenticated app can
-- invalidate and repopulate its one canonical snapshot without polling or
-- optimistic balance mutation. Existing table RLS remains authoritative.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'bridge_balance_ledger',
    'transactions',
    'notifications'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end
$$;
