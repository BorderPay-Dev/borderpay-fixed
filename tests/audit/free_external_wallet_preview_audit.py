from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()

stablecoin_start = source.index("if (method === 'stablecoin')")
stablecoin_end = source.index("const country =", stablecoin_start)
stablecoin_preview = source[stablecoin_start:stablecoin_end]

required = (
    "feePercent: 0",
    "percentFee: 0",
    "totalFee: 0",
    "netAmount: num",
)
missing = [token for token in required if token not in stablecoin_preview]
if missing:
    raise SystemExit(f"External-wallet preview is not free; missing: {missing}")

for forbidden in ("developer_fee_percent", "routeDeveloperFeePercent"):
    if forbidden in stablecoin_preview:
        raise SystemExit(f"External-wallet preview reads stale provider fee metadata: {forbidden}")

print("External digital-dollar preview audit: PASS (0% / Free)")
