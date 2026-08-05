from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

dashboard = (ROOT / "components/app/Dashboard.tsx").read_text()
app_context = (ROOT / "utils/app/AppContext.tsx").read_text()
send = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
receive = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
backend_api = (ROOT / "utils/api/backendAPI.ts").read_text()
transaction = (ROOT / "supabase/functions/yellowcard-sandbox-transaction/index.ts").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()

assert "balance >= 0" in dashboard, "zero-balance provisioned wallets must remain visible"
assert "currency,balance,status,kind" not in app_context, "wallet query references nonexistent kind column"
assert "yellowCardCustomerFee(selectedAfricanPolicyRow.raw" in send
assert "yellowCardCustomerFee(selectedAfricanPolicyRow.raw" in receive
assert "customer_fee_schedule" in capabilities
assert 'endpoint === \'yellowcard-capabilities\'' in backend_api
assert "Promise.all([" in transaction and 'path: "/channels"' in transaction and 'path: "/networks"' in transaction
assert ">{bank.code}</p>" not in send, "provider network IDs must not be customer-facing"

print("recovery P0 Yellow Card/PWA audit passed")
