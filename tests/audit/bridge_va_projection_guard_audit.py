from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HANDLER = ROOT / "supabase/functions/process-pending-events/index.ts"
EMAIL = ROOT / "supabase/functions/send-email/index.ts"
REPAIR = ROOT / "supabase/migrations/20260729121000_repair_va_converted_asset_projection.sql"


def must(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


handler = HANDLER.read_text()
email = EMAIL.read_text()
repair = REPAIR.read_text()

must("FIAT_VA_CURRENCIES" in handler, "VA handler must define fiat-source currency guard")
must("BRIDGE_SETTLEMENT_ASSET_CURRENCIES" in handler, "VA handler must identify converted asset currencies")
must("isConvertedVirtualAccountSettlementEvent" in handler, "VA handler must detect converted settlement events")
must("isFiatVirtualAccountCreditEvent(activityType, currency, eventCurrency)" in handler, "VA credit path must require fiat source/event match")
must("converted_settlement_status_only" in handler, "Converted settlement events must be status-only")
must("Do not email on the first fiat funds_received leg" in handler, "Funds-received leg should not send duplicate final receipt email")
must("payload?.deposit_id" in handler.split("function bridgeReceiptId", 1)[1].split("function normalizeCurrencyCode", 1)[0], "Deposit id must be the primary idempotency key")

must('.eq("status", "queued")' in email and '.eq("attempts", 0)' in email, "Email sends must atomically claim one queued attempt")
must("deduped: true" in email, "Duplicate email attempts must return deduped response")

must("converted_asset_settlement_was_projected_as_virtual_account_balance" in repair, "Repair migration must explain the projection correction")
must("upper(currency) in ('USDC', 'USDT', 'PYUSD', 'USDB', 'EURC')" in repair, "Repair migration must target converted asset credits only")
must("on conflict (event_id) do nothing" in repair, "Repair migration must be idempotent")

print("bridge_va_projection_guard_audit: PASS")
