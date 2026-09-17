begin;

create or replace function public.save_partner_application_draft(
  p_application_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_patch jsonb
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_app public.partner_applications%rowtype;
  v_field text;
  v_entity jsonb;
  v_products text[];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Application patch must be an object' using errcode = '22023';
  end if;
  select * into v_app from public.partner_applications
    where id = p_application_id and organization_id = p_organization_id for update;
  if not found or v_app.status not in ('draft', 'more_information') then
    raise exception 'Application is not editable' using errcode = '42501';
  end if;
  perform 1 from public.partner_organizations
    where id = p_organization_id and status in ('draft', 'more_information') for update;
  if not found then
    raise exception 'Partner organization is not editable' using errcode = '42501';
  end if;
  perform 1 from public.partner_members
    where organization_id = p_organization_id and user_id = p_actor_user_id
      and is_active and role in ('owner', 'admin', 'compliance') for share;
  if not found then
    raise exception 'Partner owner, admin or compliance access required' using errcode = '42501';
  end if;
  foreach v_field in array array['entity_details','operating_details','compliance_details','technical_details','declarations'] loop
    if p_patch ? v_field and jsonb_typeof(p_patch -> v_field) <> 'object' then
      raise exception 'Application sections must be objects' using errcode = '22023';
    end if;
  end loop;
  v_products := v_app.requested_products;
  if p_patch ? 'requested_products' then
    if jsonb_typeof(p_patch -> 'requested_products') <> 'array' then
      raise exception 'Requested products must be an array' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct value), '{}'::text[]) into v_products
      from jsonb_array_elements_text(p_patch -> 'requested_products');
    if not (v_products <@ array['api','white_label']::text[]) or cardinality(v_products) > 1 then
      raise exception 'Choose one valid partner operating model' using errcode = '22023';
    end if;
  end if;

  -- Both records and the audit entry commit together, or none do.
  if p_patch ? 'entity_details' then
    v_entity := p_patch -> 'entity_details';
    update public.partner_organizations set
      legal_name = nullif(left(btrim(v_entity ->> 'legal_name'), 200), ''),
      trading_name = nullif(left(btrim(v_entity ->> 'trading_name'), 200), ''),
      website = nullif(left(btrim(v_entity ->> 'website'), 500), ''),
      country_of_incorporation = nullif(upper(btrim(v_entity ->> 'country_of_incorporation')), ''),
      registration_number = nullif(left(btrim(v_entity ->> 'registration_number'), 120), ''),
      updated_at = now()
    where id = p_organization_id;
  end if;
  update public.partner_applications set
    entity_details = coalesce(p_patch -> 'entity_details', entity_details),
    operating_details = coalesce(p_patch -> 'operating_details', operating_details),
    compliance_details = coalesce(p_patch -> 'compliance_details', compliance_details),
    technical_details = coalesce(p_patch -> 'technical_details', technical_details),
    declarations = coalesce(p_patch -> 'declarations', declarations),
    requested_products = v_products, updated_at = now()
  where id = p_application_id returning * into v_app;
  insert into public.partner_portal_audit_log
    (organization_id, application_id, actor_user_id, event_type, metadata)
    values (p_organization_id, p_application_id, p_actor_user_id, 'application_draft_saved',
      jsonb_build_object('sections', (select jsonb_agg(key) from jsonb_object_keys(p_patch) as key)));
  return to_jsonb(v_app);
end;
$$;
revoke all on function public.save_partner_application_draft(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_partner_application_draft(uuid,uuid,uuid,jsonb) to service_role;

commit;
