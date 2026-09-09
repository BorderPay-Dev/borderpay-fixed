-- Fail closed for API/white-label tenant records that predate the durable
-- partner-approval gate. Stored flags and credentials must not become live
-- merely because an approval record is later added.

update public.api_keys k
set
  is_active = false,
  revoked_at = coalesce(k.revoked_at, now()),
  updated_at = now()
where k.is_active = true
  and k.revoked_at is null
  and not exists (
    select 1
    from public.api_partner_approvals a
    where a.tenant_id = k.tenant_id
      and a.status = 'approved'
  );

update public.api_tenants t
set
  is_active = false,
  beta_access_enabled = false,
  metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'onboarding',
      coalesce(t.metadata -> 'onboarding', '{}'::jsonb) || jsonb_build_object(
        'individual_signup_enabled', false,
        'business_signup_enabled', false,
        'white_label_signup_enabled', false
      ),
    'white_label',
      coalesce(t.metadata -> 'white_label', '{}'::jsonb) || jsonb_build_object(
        'enabled', false
      )
  ),
  updated_at = now()
where not exists (
  select 1
  from public.api_partner_approvals a
  where a.tenant_id = t.id
    and a.status = 'approved'
);
