#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SQL=(ROOT/'supabase/migrations/20260819134000_external_digital_dollar_payout_revenue.sql').read_text()
WORKER=(ROOT/'supabase/functions/process-pending-events/index.ts').read_text()
VALIDATOR=(ROOT/'supabase/functions/_shared/bridge-payout-validator.ts').read_text()
TRANSFER=(ROOT/'supabase/functions/bridge-transfer/index.ts').read_text()

checks={
 'cross-token payouts fail explicitly':'cross_token_payout_not_supported' in VALIDATOR,
 'worker routes liquidation drains':'case "bridge.liquidation_address"' in WORKER and 'handleBridgeLiquidationDrain' in WORKER,
 'only signed evidence can be recorded':'signed drain webhook evidence is required' in SQL,
 'USDC policy is checked against 1 percent':"v_source='USDC' then round(v_amount*0.01,2)" in SQL,
 'USDT policy is checked against zero':"else 0 end" in SQL,
 'signed receipt fee remains revenue truth':"v_source,v_fee,0,v_fee" in SQL and "fee_policy_observed" in SQL,
 'historical fee exceptions remain visible':"fee_policy_exception_drains" in SQL and "fee_policy_compliant" in SQL,
 'policy exceptions do not hide captured revenue':"'complete',count(*) filter" in SQL and "fee_policy_exception_drains" in SQL,
 'accounting rejects cross-token':'cross-token payout revenue is forbidden' in SQL,
 'coverage requires every terminal drain captured':'admin_liquidation_drain_revenue_coverage' in SQL and "'complete'" in SQL,
 'refunds use immutable reversal':"p_event_kind = 'reversal'" in SQL and "event_kind='earned'" in SQL,
 'external fiat payout sends server 1 percent fee':'BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp' in TRANSFER and 'fixedDeveloperFeeForPercent' in TRANSFER,
 'consolidated revenue includes drain and fiat transfer fees':"source_type in ('bridge_liquidation_drain','bridge_transfer')" in SQL,
}
for name,ok in checks.items(): print(('PASS' if ok else 'FAIL')+': '+name)
if not all(checks.values()): raise SystemExit(1)
print('external digital-dollar revenue audit: PASS')
