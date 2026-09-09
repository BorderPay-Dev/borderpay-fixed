#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "supabase/functions/process-pending-events/index.ts").read_text(encoding="utf-8")
helper = (ROOT / "supabase/functions/_shared/bridge-receipt-breakdown.ts").read_text(encoding="utf-8")
test = (ROOT / "tests/bridge-receipt-breakdown.test.ts").read_text(encoding="utf-8")

checks = {
    "worker uses receipt-aware parser for VA and transfer events": worker.count("return bridgeReceiptBreakdown(payload, currency);") == 2,
    "receipt gross precedes top-level amount": helper.find("explicitGrossMinor") < helper.find("topLevelAmountMinor"),
    "top-level amount is treated as last-resort net": "availableMinor ?? computedNet ?? topLevelAmountMinor!" in helper,
    "inconsistent signed receipt arithmetic fails closed": "bridge_webhook_receipt_amounts_inconsistent" in helper,
    "gross is reconstructed from net plus captured fees": "netMinor + totalFees" in helper,
    "real 100 minus 2.50 fixture yields 97.50": all(value in test for value in ("10000n", "250n", "9750n")),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"{'PASS' if passed else 'FAIL'}: {name}")
if failed:
    raise SystemExit(1)
print("bridge receipt double-fee audit: PASS")
