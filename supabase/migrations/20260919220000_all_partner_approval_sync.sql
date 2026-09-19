begin;
-- Repair only a missing sandbox provisioning record backed by a recorded KYB approval.
-- Existing approvals, suspension decisions and production tenants are never overwritten.
create or replace function public.reconcile_partner_sandbox_approval(p_tenant_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tenant public.api_tenants%rowtype;v_org public.partner_organizations%rowtype;
 v_app public.partner_applications%rowtype;v_review public.partner_application_reviews%rowtype;
 v_existing public.api_partner_approvals%rowtype;v_technical text;v_compliance text;v_incident text;v_use_case text;
begin
 if length(btrim(coalesce(p_actor,'')))=0 then raise exception 'Actor attribution is required' using errcode='22023';end if;
 select * into v_tenant from public.api_tenants where id=p_tenant_id for update;
 if not found then raise exception 'Tenant not found' using errcode='22023';end if;
 select * into v_existing from public.api_partner_approvals where tenant_id=p_tenant_id for update;
 if found then return to_jsonb(v_existing);end if;
 if v_tenant.default_mode is distinct from 'sandbox' then raise exception 'Automatic product approval is limited to sandbox tenants' using errcode='42501';end if;
 if (select count(*) from public.partner_organizations where approved_tenant_id=p_tenant_id)<>1 then raise exception 'A unique approved partner application must be linked to this tenant' using errcode='42501';end if;
 select * into v_org from public.partner_organizations where approved_tenant_id=p_tenant_id for update;
 if v_org.status<>'approved' then raise exception 'Partner KYB is not approved' using errcode='42501';end if;
 select * into v_app from public.partner_applications where organization_id=v_org.id order by version desc,created_at desc,id desc limit 1 for update;
 if not found or v_app.status<>'approved' then raise exception 'The latest partner application must be approved' using errcode='42501';end if;
 select * into v_review from public.partner_application_reviews where application_id=v_app.id order by created_at desc,id desc limit 1;
 if not found or v_review.decision<>'approved' or v_review.reviewer_user_id is null then raise exception 'A recorded approval decision is required' using errcode='42501';end if;
 if cardinality(v_app.requested_products)<>1 or v_app.requested_products[1] not in ('api','white_label') or v_app.requested_products is null then raise exception 'An approved partner product is required' using errcode='22023';end if;
 v_technical:=lower(btrim(v_app.technical_details->>'technical_contact_email'));
 v_compliance:=lower(btrim(v_app.technical_details->>'compliance_contact_email'));
 v_incident:=lower(btrim(v_app.technical_details->>'security_contact_email'));
 if coalesce(v_technical,'')!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or coalesce(v_compliance,'')!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or coalesce(v_incident,'')!~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Complete the technical, compliance and security contacts in Partner KYB' using errcode='22023';end if;
 v_use_case:=coalesce(nullif(btrim(v_app.operating_details->>'intended_use'),''),nullif(btrim(v_app.operating_details->>'business_model'),''));
 if v_use_case is null then raise exception 'The approved application requires an intended use' using errcode='22023';end if;
 insert into public.api_partner_approvals(tenant_id,status,partner_type,approved_products,approved_use_case,technical_contact_email,compliance_contact_email,incident_contact_email,compliance_approval_reference,engineering_approval_reference,compliance_approved_by,engineering_approved_by,recorded_by,approved_at)
 values(p_tenant_id,'approved','platform',v_app.requested_products,left(v_use_case,2000),v_technical,v_compliance,v_incident,
 'partner-review:'||v_review.id,'sandbox-provisioning-reconciliation:'||v_app.id,v_review.reviewer_user_id::text,
 'automated sandbox provisioning',left(p_actor,254),now())
 on conflict(tenant_id) do nothing;
 select * into v_existing from public.api_partner_approvals where tenant_id=p_tenant_id;
 insert into public.partner_portal_audit_log(organization_id,application_id,event_type,metadata)
 values(v_org.id,v_app.id,'sandbox_product_approval_reconciled',jsonb_build_object('tenant_id',p_tenant_id,'review_id',v_review.id,'recorded_by',left(p_actor,254),'approved_products',v_existing.approved_products,'production_access',false));
 return to_jsonb(v_existing);
end;$$;
revoke all on function public.reconcile_partner_sandbox_approval(uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_partner_sandbox_approval(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.record_partner_application_decision(p_application_id uuid, p_actor_user_id uuid, p_decision text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Synchronize the product record only after the recorded KYB decision exists.
  -- Tenant activation and production release remain separate operator actions.
  if p_decision='approved' and v_tenant_id is not null
    and exists(select 1 from public.api_tenants where id=v_tenant_id and default_mode='sandbox') then
    perform public.reconcile_partner_sandbox_approval(v_tenant_id,p_actor_user_id::text);
  end if;
  return jsonb_build_object('review_id',v_review_id,'application_id',p_application_id,'organization_id',v_org.id,
    'recipient',v_org.primary_email,'partner_name',coalesce(nullif(btrim(v_app.entity_details->>'legal_name'),''),v_org.legal_name,v_org.primary_email),
    'decision',p_decision,'notes',v_notes,'tenant_id',v_tenant_id,'reused',v_reused);
end;
$function$
;

-- Reconcile existing approved sandbox partners without replaying decisions or emails.
do $backfill$
declare v_partner record;
begin
 for v_partner in
  select t.id from public.api_tenants t
  join public.partner_organizations o on o.approved_tenant_id=t.id
  where t.default_mode='sandbox' and o.status='approved'
    and not exists(select 1 from public.api_partner_approvals a where a.tenant_id=t.id)
 loop
  perform public.reconcile_partner_sandbox_approval(v_partner.id,'migration:all-approved-partner-product-sync');
 end loop;
end;
$backfill$;

commit;