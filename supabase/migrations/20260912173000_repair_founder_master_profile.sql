-- Repair the authenticated BorderPay operator identity after its obsolete
-- customer import was offboarded. The live treasury customer remains the
-- server-side operator mapping and is excluded from customer lifecycle jobs.

begin;

do $$
declare
  v_user_id constant uuid := 'b000f84b-5488-4a8a-b934-f669978c7e20';
  v_email constant text := 'founder@borderpayafrica.com';
  v_old_customer constant text := '89a7491e-8592-4d23-bb4f-3870f2ddd73b';
  v_master_customer constant text := 'de412f3c-53c3-4d4a-987e-09d17c9cd7e2';
begin
  if not exists (
    select 1
    from public.operator_bridge_app_access
    where auth_email = v_email
      and bridge_customer_id = v_master_customer
      and active = true
  ) then
    raise exception 'active founder master mapping is missing';
  end if;

  update public.user_profiles
  set bridge_customer_id = v_master_customer,
      country = 'US',
      kyc_status = 'approved'::public.kyc_status,
      account_status = 'active',
      bridge_kyc_status = 'approved',
      bridge_verification_status = 'approved',
      bridge_account_status = 'active',
      bridge_account_paused_at = null,
      updated_at = now()
  where id = v_user_id
    and lower(email) = v_email
    and bridge_customer_id = v_old_customer
    and account_frozen_at is null;

  if not found then
    raise exception 'founder user profile did not match guarded repair state';
  end if;

  update public.business_profiles
  set bridge_customer_id = v_master_customer,
      country = 'US',
      address = '131 Continental Drive, Suite 305',
      city = 'Newark',
      state = 'Delaware',
      postal_code = '19713',
      status = 'active',
      bridge_kyb_status = 'approved',
      bridge_kyb_completed_at = coalesce(bridge_kyb_completed_at, now()),
      updated_at = now()
  where user_id = v_user_id
    and lower(company_email) = v_email
    and bridge_customer_id = v_old_customer;

  if not found then
    raise exception 'founder business profile did not match guarded repair state';
  end if;

  update public.users
  set country = 'US',
      kyc_status = 'approved'::public.kyc_status,
      wallet_activated = true,
      updated_at = now()
  where id = v_user_id
    and lower(email) = v_email;

  if not found then
    raise exception 'founder legacy user mirror is missing';
  end if;
end $$;

commit;
