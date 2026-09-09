-- The admin dashboard calls this RPC with the signed-in operator JWT.
-- Authorization remains enforced inside the SECURITY DEFINER function by
-- public.is_borderpay_admin(); anonymous execution stays revoked.

revoke all on function public.admin_terminal_settled_revenue_summary() from public, anon;
grant execute on function public.admin_terminal_settled_revenue_summary() to authenticated, service_role;
