from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
receive = (ROOT / "supabase/functions/yellowcard-receive/index.ts").read_text()
client = (ROOT / "supabase/functions/_shared/providers/yellowcard-client.ts").read_text()
config = (ROOT / "supabase/config.toml").read_text()
ui = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
payload = (ROOT / "supabase/functions/_shared/providers/yellowcard-payload.ts").read_text()
capabilities = (ROOT / "supabase/functions/yellowcard-capabilities/index.ts").read_text()
rate_math = (ROOT / "supabase/functions/_shared/providers/yellowcard-rate.ts").read_text()

checks = {
    "production environment required": 'config.environment !== "production"' in receive,
    "production receive flag required": 'flag("YC_PRODUCTION_RECEIVE_ENABLED")' in receive,
    "send explicitly blocked": 'code: "yellow_card_send_not_enabled"' in receive,
    "production rows are isolated": 'environment: "production"' in receive,
    "settlement wallet comes from Bridge inventory": '.from("bridge_wallets")' in receive,
    "preflight confirms resolved settlement wallet": 'bridge_settlement_wallet_ready: true' in receive,
    "receive quote divides local amount by live rate": 'direction === "receive"' in rate_math and 'sourceAmount / localPerUsdRate' in rate_math,
    "capability quote uses direction-aware conversion": 'yellowCardDestinationAmount(amount, quote.rate, direction' in capabilities,
    "UI labels settlement as digital dollars": 'Estimated digital dollars received' in ui,
    "UI displays selected USDC or USDT settlement asset": 'collectionSettlementAsset' in ui,
    "direct settlement force-accept present": 'forceAccept: true' in payload,
    "provider local amount is verified": 'parseYellowCardReceiveInstruction' in receive,
    "production request uses receive only": 'path: "/receive"' in receive,
    "production relay fails closed": 'yellow_card_production_relay_not_configured' in client,
    "receive function requires JWT": '[functions.yellowcard-receive]\nverify_jwt = true' in config,
    "UI uses production receive endpoint": 'yellowCardReceive({' in ui,
    "UI submits payer account number": "source_account:" in ui,
    "backend requires payer account number": 'yellow_card_missing_source_account_number' in payload,
    "UI does not default a missing settlement wallet": "settlementWallet?.currency || 'USDC'" not in ui,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    for name in failed:
        print(f"FAIL: {name}")
    raise SystemExit(1)

print(f"Yellow Card production Receive audit: PASS ({len(checks)}/{len(checks)})")
