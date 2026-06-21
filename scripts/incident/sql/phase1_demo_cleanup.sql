-- STOP: INCIDENT-ONLY SCRIPT. DO NOT RUN IN NORMAL CI/CD OR MIGRATIONS.
-- STOP: NO-PITR ENVIRONMENT. EXECUTE ONLY WITH EXPLICIT OPERATOR APPROVAL.
-- Purpose:
--   Remove two confirmed legacy demo identities and their direct dependencies.
-- Scope guard:
--   Only user IDs:
--     6ab47d98-1855-4f6e-afb2-15dfa46c79d1
--     a4b3fccf-ac76-41f1-9727-432feffd8dac
--   and emails:
--     demo.business@borderpayafrica.com
--     demo.individual@borderpayafrica.com

begin;

-- STOP: Optional dry-run mode.
-- Keep this script inside an open transaction and run `rollback;` instead of `commit;`
-- to test guardrails without persisting changes.

do $$
declare
  v_target_user_profiles int;
  v_target_business_profiles int;
  v_target_auth_users int;

  v_user_profiles_missing int;
  v_business_profiles_missing int;

  v_transactions int;
  v_user_subscriptions int;
  v_wallets int;
  v_webauthn_challenges int;
  v_webauthn_credentials int;
  v_account_type_audit int;

  v_auth_identities int;
  v_auth_sessions int;
  v_auth_refresh_tokens int;
begin
  -- 1) Target identity guards.
  select count(*) into v_target_user_profiles
  from public.user_profiles
  where id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  )
    and is_demo = true
    and lower(email) in ('demo.business@borderpayafrica.com', 'demo.individual@borderpayafrica.com');

  if v_target_user_profiles <> 2 then
    raise exception 'Guard failed: expected 2 target demo user_profiles, got %', v_target_user_profiles;
  end if;

  select count(*) into v_target_business_profiles
  from public.business_profiles
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;

  if v_target_business_profiles <> 1 then
    raise exception 'Guard failed: expected 1 target business_profile row, got %', v_target_business_profiles;
  end if;

  select count(*) into v_target_auth_users
  from auth.users
  where id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  if v_target_auth_users <> 2 then
    raise exception 'Guard failed: expected 2 auth.users rows, got %', v_target_auth_users;
  end if;

  -- 2) Expected dependency count guards (abort on drift).
  select count(*) into v_transactions
  from public.transactions
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );
  if v_transactions <> 8 then
    raise exception 'Guard failed: expected 8 transactions rows, got %', v_transactions;
  end if;

  select count(*) into v_user_subscriptions
  from public.user_subscriptions
  where user_id = 'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
     or business_user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;
  if v_user_subscriptions <> 2 then
    raise exception 'Guard failed: expected 2 user_subscriptions rows, got %', v_user_subscriptions;
  end if;

  select count(*) into v_wallets
  from public.wallets
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );
  if v_wallets <> 2 then
    raise exception 'Guard failed: expected 2 wallets rows, got %', v_wallets;
  end if;

  select count(*) into v_webauthn_challenges
  from public.webauthn_challenges
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;
  if v_webauthn_challenges <> 2 then
    raise exception 'Guard failed: expected 2 webauthn_challenges rows, got %', v_webauthn_challenges;
  end if;

  select count(*) into v_webauthn_credentials
  from public.webauthn_credentials
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;
  if v_webauthn_credentials <> 1 then
    raise exception 'Guard failed: expected 1 webauthn_credentials row, got %', v_webauthn_credentials;
  end if;

  select count(*) into v_account_type_audit
  from public.account_type_audit
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;
  if v_account_type_audit <> 1 then
    raise exception 'Guard failed: expected 1 account_type_audit row, got %', v_account_type_audit;
  end if;

  select count(*) into v_auth_identities
  from auth.identities
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );
  if v_auth_identities <> 2 then
    raise exception 'Guard failed: expected 2 auth.identities rows, got %', v_auth_identities;
  end if;

  select count(*) into v_auth_sessions
  from auth.sessions
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );
  if v_auth_sessions <> 1 then
    raise exception 'Guard failed: expected 1 auth.sessions row, got %', v_auth_sessions;
  end if;

  select count(*) into v_auth_refresh_tokens
  from auth.refresh_tokens
  where user_id::text in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1',
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'
  );
  if v_auth_refresh_tokens <> 2 then
    raise exception 'Guard failed: expected 2 auth.refresh_tokens rows, got %', v_auth_refresh_tokens;
  end if;

  -- 3) Delete in dependency-safe order.
  delete from auth.refresh_tokens
  where user_id::text in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1',
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'
  );

  delete from auth.sessions
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  delete from auth.identities
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  delete from public.webauthn_credentials
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;

  delete from public.webauthn_challenges
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;

  delete from public.wallets
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  delete from public.user_subscriptions
  where user_id = 'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
     or business_user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;

  delete from public.transactions
  where user_id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  delete from public.account_type_audit
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;

  delete from public.business_profiles
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;

  delete from public.user_profiles
  where id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  delete from auth.users
  where id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );

  -- 4) Post-delete assertions (inside txn).
  select count(*) into v_user_profiles_missing
  from public.user_profiles
  where id in (
    '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
    'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
  );
  if v_user_profiles_missing <> 0 then
    raise exception 'Post-delete failed: user_profiles still contains target rows (%)', v_user_profiles_missing;
  end if;

  select count(*) into v_business_profiles_missing
  from public.business_profiles
  where user_id = '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid;
  if v_business_profiles_missing <> 0 then
    raise exception 'Post-delete failed: business_profiles still contains target rows (%)', v_business_profiles_missing;
  end if;
end $$;

-- Post-delete verification SQL (operator must review before COMMIT).
select 'user_profiles_approved_without_customer' as check_name,
       count(*)::int as count_value
from public.user_profiles
where bridge_kyc_status = 'approved' and bridge_customer_id is null;

select 'business_profiles_approved_without_customer' as check_name,
       count(*)::int as count_value
from public.business_profiles
where bridge_kyb_status = 'approved' and bridge_customer_id is null;

select 'target_user_profiles_remaining' as check_name, count(*)::int as count_value
from public.user_profiles
where id in (
  '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
  'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
);

select 'target_auth_users_remaining' as check_name, count(*)::int as count_value
from auth.users
where id in (
  '6ab47d98-1855-4f6e-afb2-15dfa46c79d1'::uuid,
  'a4b3fccf-ac76-41f1-9727-432feffd8dac'::uuid
);

-- STOP: Commit only after human verification of all checks above.
-- commit;

-- Rollback guidance:
-- 1) Before execution, export all touched rows to incident artifacts.
-- 2) If any guard fails, transaction auto-rolls back.
-- 3) For dry-run, execute this script and then run:
--    rollback;
-- 4) For committed rollback in no-PITR env, restore exported rows in dependency order.
