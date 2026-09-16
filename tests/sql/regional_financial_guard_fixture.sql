-- Disposable CI database only; run after existing regional read contracts.
create table public.bridge_eea_sca_runtime_control(singleton boolean primary key, enforcement_enabled boolean);
insert into public.bridge_eea_sca_runtime_control values(true,true);
create function public.is_borderpay_admin() returns boolean language sql stable as $$
 select coalesce(current_setting('test.admin',true),'')='true'
$$;
create function public.has_fresh_sca_wallet_access(uuid) returns boolean language sql stable as $$
 select coalesce(current_setting('test.fresh_access',true),'')='true'
$$;
