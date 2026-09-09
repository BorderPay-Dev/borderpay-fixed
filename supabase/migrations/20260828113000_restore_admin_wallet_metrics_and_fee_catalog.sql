-- Restore the authenticated admin read path after privilege hardening and
-- reconcile the operator fee catalogue with the live BorderPay policy.

revoke all on function public.admin_bridge_wallet_webhook_metrics() from public, anon;
grant execute on function public.admin_bridge_wallet_webhook_metrics() to authenticated, service_role;

update public.fee_schedule
set provider_fee_fixed = 0,
    provider_fee_percent = 0,
    borderpay_markup_fixed = 0,
    borderpay_markup_percent = 2.0,
    notes = 'provider=bridge;rail=external_account_fiat;borderpay_markup=2.00%;developer_fee'
where product = 'bridge_external_fiat_transfer';

delete from public.fee_schedule
where product = 'transfer_fee'
   or product like 'flutterwave\_%' escape '\';
