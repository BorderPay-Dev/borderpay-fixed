#!/usr/bin/env python3
from pathlib import Path


root = Path(__file__).resolve().parents[2]
expected = {
    "components/app/Dashboard.tsx": '<div className="mx-auto w-full max-w-2xl">',
    "components/business/BusinessDashboard.tsx": '<div className="mx-auto w-full max-w-2xl">',
    "components/send/SendMoneyFlow.tsx": '<div className="mx-auto w-full max-w-2xl">',
    "components/receive/ReceiveMoneyScreen.tsx": 'className="max-w-2xl mx-auto',
}

for relative_path, marker in expected.items():
    source = (root / relative_path).read_text(encoding="utf-8")
    if marker not in source:
        raise SystemExit(f"FAIL: {relative_path} does not use the standard financial-surface width")

business = (root / "components/business/BusinessDashboard.tsx").read_text(encoding="utf-8")
if '<div className="mx-auto w-full max-w-screen-xl">' in business:
    raise SystemExit("FAIL: Business Dashboard still expands to the extra-wide desktop container")

print("desktop_financial_surface_width_audit: PASS")
