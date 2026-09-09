-- Export SCA audit events into the existing independently signed audit chain.
-- The external delivery worker applies a five-year COMPLIANCE-mode retention
-- requirement to records whose table_name is `sca_audit_events`.

create or replace function public.certification_audit_safe_sca_values(row_value jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when row_value is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', row_value -> 'id',
    'user_id', row_value -> 'user_id',
    'authorization_id', row_value -> 'authorization_id',
    'event_type', row_value -> 'event_type',
    'operation', row_value -> 'operation',
    'resource', row_value -> 'resource',
    'payload_hash', row_value -> 'payload_hash',
    'reason', row_value -> 'reason',
    'created_at', row_value -> 'created_at'
  )) end;
$$;

revoke all on function public.certification_audit_safe_sca_values(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.capture_sca_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  row_value jsonb := coalesce(new_row, old_row);
begin
  perform public.certification_audit_append(
    tg_table_schema,
    tg_table_name,
    tg_op,
    coalesce(row_value ->> 'id', row_value ->> 'authorization_id'),
    public.certification_audit_changed_fields(old_row, new_row),
    public.certification_audit_actor(),
    public.certification_audit_safe_sca_values(old_row),
    public.certification_audit_safe_sca_values(new_row)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.capture_sca_audit_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists certification_audit_public_sca_audit_events
  on public.sca_audit_events;
create trigger certification_audit_public_sca_audit_events
after insert or update or delete on public.sca_audit_events
for each row execute function public.capture_sca_audit_mutation();

drop trigger if exists certification_audit_public_sca_audit_events_truncate
  on public.sca_audit_events;
create trigger certification_audit_public_sca_audit_events_truncate
after truncate on public.sca_audit_events
for each statement execute function public.capture_sca_audit_mutation();

comment on function public.capture_sca_audit_mutation() is
  'Exports sanitized SCA audit mutations into the hash-chained external-delivery ledger; credentials and secrets are excluded.';
