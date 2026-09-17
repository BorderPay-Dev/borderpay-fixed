begin;
-- Run only inside a transaction and ROLLBACK. No external provider actions.
do $$
declare
  v_app uuid; v_org uuid; v_user uuid; v_result jsonb; v_name text;
  v_audits bigint; v_denied boolean;
begin
  select a.id, a.organization_id, m.user_id into v_app,v_org,v_user
    from public.partner_applications a
    join public.partner_organizations o on o.id=a.organization_id
    join public.partner_members m on m.organization_id=o.id
    where a.status='draft' and o.status='draft' and m.role='owner' and m.is_active
    limit 1;
  if v_app is null then raise exception 'Requires an active draft owner fixture'; end if;
  select count(*) into v_audits from public.partner_portal_audit_log
    where application_id=v_app and event_type='application_draft_saved';
  v_result := public.save_partner_application_draft(v_app,v_org,v_user,
    '{"entity_details":{"legal_name":"Rollback Test Limited","registration_number":"TEST-123","country_of_incorporation":"NG"},"requested_products":["white_label"],"compliance_details":{"regulated":false}}');
  if v_result #>> '{entity_details,legal_name}' <> 'Rollback Test Limited'
    or (select legal_name from public.partner_organizations where id=v_org) <> 'Rollback Test Limited'
    or v_result #>> '{compliance_details,regulated}' <> 'false' then
    raise exception 'Application and organization were not saved consistently';
  end if;
  if (select count(*) from public.partner_portal_audit_log where application_id=v_app and event_type='application_draft_saved') <> v_audits+1 then
    raise exception 'Missing save audit';
  end if;
  v_denied:=false;
  begin
    perform public.save_partner_application_draft(v_app,v_org,'00000000-0000-4000-8000-000000000000','{}');
  exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'Nonmember actor accepted'; end if;
  update public.partner_members set role='viewer' where organization_id=v_org and user_id=v_user;
  v_denied:=false;
  begin
    perform public.save_partner_application_draft(v_app,v_org,v_user,'{}');
  exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'Viewer accepted'; end if;
  update public.partner_members set role='compliance' where organization_id=v_org and user_id=v_user;
  perform public.save_partner_application_draft(v_app,v_org,v_user,'{}');
  update public.partner_applications set status='more_information' where id=v_app;
  -- A later application constraint failure must roll back the earlier organization write.
  v_denied:=false;
  begin
    perform public.save_partner_application_draft(v_app,v_org,v_user,
      '{"entity_details":{"legal_name":"Must Not Persist","country_of_incorporation":"NG"},"requested_products":[]}');
  exception when check_violation or raise_exception then v_denied:=true; end;
  if not v_denied or (select legal_name from public.partner_organizations where id=v_org) <> 'Rollback Test Limited' then
    raise exception 'Failed application save left a partial organization write';
  end if;
  update public.partner_applications set status='submitted' where id=v_app;
  v_denied:=false;
  begin
    perform public.save_partner_application_draft(v_app,v_org,v_user,'{}');
  exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'Submitted application editable'; end if;
  if has_function_privilege('authenticated','public.save_partner_application_draft(uuid,uuid,uuid,jsonb)','execute') then
    raise exception 'RPC exposed to direct browser calls';
  end if;
end;
$$;

rollback;
