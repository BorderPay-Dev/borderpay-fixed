-- Record a decision and audit together. Repeating the same saved decision uses
-- the same review/email idempotency key instead of approving or emailing twice.
begin;
create or replace function public.record_partner_application_decision(
  p_application_id uuid, p_actor_user_id uuid, p_decision text, p_notes text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_app public.partner_applications%rowtype;
  v_org public.partner_organizations%rowtype;
  v_previous public.partner_application_reviews%rowtype;
  v_review_id uuid;
  v_tenant_id uuid;
  v_notes text := btrim(coalesce(p_notes,''));
  v_reused boolean := false;
begin
  if not exists (select 1 from public.admin_users where user_id=p_actor_user_id
    and upper(role::text) in ('ADMIN_SUPER','SUPER_ADMIN','ADMIN')) then
    raise exception 'Super admin access required' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('under_review','more_information','approved','rejected','suspended')
    or v_notes='' or length(v_notes)>4000 then raise exception 'Valid decision and review notes required'; end if;
  select * into v_app from public.partner_applications where id=p_application_id for update;
  if not found then raise exception 'Partner application not found'; end if;
  select * into v_org from public.partner_organizations where id=v_app.organization_id for update;
  if not found then raise exception 'Partner organization not found'; end if;
  v_tenant_id := v_org.approved_tenant_id;
  select * into v_previous from public.partner_application_reviews
    where application_id=p_application_id order by created_at desc,id desc limit 1;
  if v_previous.id is not null and v_previous.decision=p_decision
    and v_previous.notes=v_notes and v_previous.reviewer_user_id=p_actor_user_id
    and v_app.status=p_decision and v_org.status=p_decision then
    v_review_id := v_previous.id;
    v_reused := true;
  else
    if p_decision='approved' and v_tenant_id is null then
      insert into public.api_tenants(tenant_name,default_mode,is_active,beta_access_enabled,metadata)
      values(coalesce(v_org.legal_name,v_org.primary_email),'sandbox',false,false,
        jsonb_build_object('partner_organization_id',v_org.id,'provisioning_status','operator_required','pricing_source','partner_custom_only'))
      returning id into v_tenant_id;
    end if;
    update public.partner_applications set status=p_decision,decision_summary=v_notes,
      decided_at=case when p_decision in ('approved','rejected') then now() else null end,updated_at=now()
      where id=p_application_id;
    update public.partner_organizations set status=p_decision,approved_tenant_id=v_tenant_id,updated_at=now() where id=v_org.id;
    insert into public.partner_application_reviews(application_id,reviewer_user_id,decision,notes)
      values(p_application_id,p_actor_user_id,p_decision,v_notes) returning id into v_review_id;
    insert into public.partner_portal_audit_log(organization_id,application_id,actor_user_id,event_type,metadata)
      values(v_org.id,p_application_id,p_actor_user_id,'application_'||p_decision,
        jsonb_build_object('tenant_id',v_tenant_id,'review_id',v_review_id,'email_notification','pending'));
  end if;
  return jsonb_build_object('review_id',v_review_id,'application_id',p_application_id,'organization_id',v_org.id,
    'recipient',v_org.primary_email,'partner_name',coalesce(nullif(btrim(v_app.entity_details->>'legal_name'),''),v_org.legal_name,v_org.primary_email),
    'decision',p_decision,'notes',v_notes,'tenant_id',v_tenant_id,'reused',v_reused);
end;
$$;
revoke all on function public.record_partner_application_decision(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_partner_application_decision(uuid,uuid,text,text) to service_role;
commit;
