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
 if v_tenant.default_mode<>'sandbox' or not v_tenant.is_active then raise exception 'Activate the approved partner sandbox before issuing credentials' using errcode='42501';end if;
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
commit;