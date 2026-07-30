from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

direction = (ROOT / "utils/transactions/direction.ts").read_text()
backend = (ROOT / "utils/api/backendAPI.ts").read_text()
dashboard = (ROOT / "components/app/Dashboard.tsx").read_text()
notif_bell = (ROOT / "components/notifications/NotificationBell.tsx").read_text()
notif_screen = (ROOT / "components/notifications/NotificationsScreen.tsx").read_text()
tx_screen = (ROOT / "components/transactions/TransactionsScreen.tsx").read_text()

failures: list[str] = []

def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)

require("metadata.direction || metadata.balance_impact" in direction,
        "txDirection must prefer explicit metadata.direction / balance_impact.")
require("metadata.source_type" in direction and "metadata.destination_type" in direction,
        "txDirection must infer Bridge wallet source/destination direction before text fallback.")
require("sourceType === 'wallet' || sourceType === 'bridge_wallet'" in direction,
        "Bridge wallet source must always render as debit.")
require("destinationType === 'wallet' || destinationType === 'bridge_wallet'" in direction,
        "Bridge wallet destination must always render as credit.")
require("txDirection({" in backend and "const metadata = { ...rowMetadata, direction }" in backend,
        "backendAPI transaction read model must derive direction with txDirection, not default missing direction to debit.")
require("String(rowMetadata?.direction || '').toLowerCase() === 'credit' ? 'credit' : 'debit'" not in backend,
        "backendAPI must not coerce missing direction to debit.")
require("row?.metadata?.bridge_transfer_id ||" in backend and "row?.metadata?.deposit_id ||" in backend,
        "backendAPI transaction read model must de-dupe payouts by bridge_transfer_id before lower-level wallet event ids.")
require(backend.find("row?.metadata?.bridge_transfer_id ||") < backend.find("row?.metadata?.bridge_event_id ||"),
        "bridge_transfer_id must be checked before bridge_event_id so wallet activity collapses into the provider transfer.")
require("const lifecycleKey =" in backend and "const lifecycleRank =" in backend,
        "backendAPI transaction read model must rank provider lifecycle states before choosing the displayed row.")
require("Transaction refunded" in backend and "Transaction under review" in backend,
        "backendAPI recent activity descriptions must expose VA review/refund lifecycle in customer-friendly language.")
require(backend.find("row?.metadata?.deposit_id ||") < backend.find("row?.metadata?.raw?.id ||"),
        "VA deposits must de-dupe by deposit_id before raw activity id so review/refund lifecycle replaces older receipt rows.")

for name, src in {
    "Dashboard": dashboard,
    "NotificationBell": notif_bell,
    "NotificationsScreen": notif_screen,
    "TransactionsScreen": tx_screen,
}.items():
    require("txDirection" in src, f"{name} must use shared txDirection.")

require("/received|deposit|credit/i.test" not in notif_bell,
        "NotificationBell must not infer credit from title regex.")
require("/received|deposit|credit/i.test" not in notif_screen,
        "NotificationsScreen must not infer credit from title regex.")
require("function transactionCanonicalId" in notif_screen and "metadata?.bridge_transfer_id ||" in notif_screen,
        "NotificationsScreen must use provider-level transaction ids for activity de-dupe.")
require(notif_screen.find("metadata?.deposit_id ||") < notif_screen.find("metadata?.raw?.id ||"),
        "NotificationsScreen must group VA activity by deposit_id before raw activity id.")
require("const statusRank =" in notif_screen and "shouldReplace(previous, row)" in notif_screen,
        "NotificationsScreen must rank provider lifecycle states so refunded/under-review notifications win over older rows.")
require("Payout completed" in notif_screen and "Payout pending" in notif_screen and "Payment received" in notif_screen,
        "NotificationsScreen transaction activity copy must be customer-friendly.")
require("txn.type === 'deposit' || txn.type === 'credit'" not in dashboard,
        "Dashboard must not classify direction from txn.type only.")
require("direction === 'credit' ? '+' : '-'" in tx_screen,
        "TransactionsScreen must display signs from txDirection output.")

if failures:
    print("transaction_direction_contract_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("transaction_direction_contract_audit: PASS")
