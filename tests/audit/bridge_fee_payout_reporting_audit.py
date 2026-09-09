from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "supabase/migrations/20260827110000_provider_revenue_native_by_provider.sql").read_text()
ADMIN_ROOT = Path("/private/tmp/borderpay-admin-reconciliation-20260826")
EDGE = (ADMIN_ROOT / "supabase/functions/admin-finops/index.ts").read_text()
CLIENT = (ADMIN_ROOT / "utils/api.ts").read_text()
UI = (ADMIN_ROOT / "components/dashboard/RevenuePage.tsx").read_text()

checks = {
    "native ledger is split by provider": "group by provider, upper(fee_currency)" in MIGRATION,
    "bridge estimate reads Bridge-only rows": "nativeRevenue.data?.providers?.bridge?.currencies" in EDGE,
    "bridge estimate is not called an actual payout": "payout_statement_available: false" in EDGE,
    "EURC uses the EUR Bridge quote": 'currency === "EURC" ? "EUR" : currency' in EDGE,
    "Bridge quote targets supported USD currency": "&to=usd" in EDGE,
    "Bridge response uses documented midmarket rate": "data.midmarket_rate" in EDGE,
    "legacy PYUSD parity is absent": '"PYUSD"' not in EDGE,
    "client total uses complete current valuation": "transactionFees: currentUsdEquivalent" in CLIENT,
    "UI labels Bridge amount as an estimate": "Estimated next Bridge fee payout" in UI,
    "UI discloses payout-statement limitation": "not the final amount Bridge will pay" in UI,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    for name in failed:
        print(f"FAIL: {name}")
    raise SystemExit(1)

print(f"bridge_fee_payout_reporting_audit: PASS ({len(checks)}/{len(checks)})")
