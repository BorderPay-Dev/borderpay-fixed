begin;

do $$
declare
  v_tenant uuid := '18120000-0000-4000-8000-000000000001';
  v_key uuid := '18120000-0000-4000-8000-000000000002';
  v_count integer;
begin
  insert into public.api_tenants (
    id, tenant_name, default_mode, is_active, beta_access_enabled, rate_limit_per_minute, metadata
  ) values (
    v_tenant, 'Partner approval regression tenant', 'sandbox', true, false, 30, '{}'::jsonb
  );

  insert into public.api_keys (
    id, tenant_id, key_prefix, key_hash, key_label, scopes, is_active
  ) values (
    v_key, v_tenant, 'bpk_test_gate1', repeat('a', 64), 'approval regression',
    array['onboarding:write']::text[], true
  );

  select count(*) into v_count
  from public.api_gateway_resolve_api_key(repeat('a', 64));
  if v_count <> 0 then
    raise exception 'tenant/key existence bypassed missing partner approval';
  end if;

  insert into public.api_partner_approvals (
    tenant_id, status, partner_type, approved_products, approved_use_case,
    technical_contact_email, compliance_contact_email, incident_contact_email,
    compliance_approval_reference, engineering_approval_reference,
    compliance_approved_by, engineering_approved_by, recorded_by, approved_at
  ) values (
    v_tenant, 'approved', 'platform', array['white_label']::text[],
    'Hosted white-label onboarding', 'tech@partner.test', 'compliance@partner.test',
    'incident@partner.test', 'COMP-TEST', 'ENG-TEST',
    'compliance-test', 'engineering-test', 'operator-test', now()
  );

  select count(*) into v_count
  from public.api_gateway_resolve_api_key(repeat('a', 64));
  if v_count <> 1 then
    raise exception 'approved white-label onboarding key did not resolve';
  end if;

  update public.api_keys set scopes = array['transfers:write']::text[] where id = v_key;
  select count(*) into v_count
  from public.api_gateway_resolve_api_key(repeat('a', 64));
  if v_count <> 0 then
    raise exception 'white-label-only approval resolved a financial API scope';
  end if;

  update public.api_partner_approvals
  set status = 'suspended', suspended_at = now(), suspended_by = 'operator-test',
      suspension_reason = 'regression test'
  where tenant_id = v_tenant;
  update public.api_keys set scopes = array['onboarding:write']::text[] where id = v_key;
  select count(*) into v_count
  from public.api_gateway_resolve_api_key(repeat('a', 64));
  if v_count <> 0 then
    raise exception 'suspended partner approval still resolved credentials';
  end if;
end $$;

rollback;
