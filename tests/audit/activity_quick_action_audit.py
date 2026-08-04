#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
individual = (ROOT / "components/app/Dashboard.tsx").read_text()
business = (ROOT / "components/business/BusinessDashboard.tsx").read_text()

checks = {
    "individual Activity opens transactions": "label={tt('dashboard.recentActivity', 'Activity')}" in individual
    and "onClick={() => handleNavigate('transactions')}" in individual,
    "business Activity opens transactions": 'label="Activity"' in business
    and "onClick={() => navigate('transactions')}" in business,
    "individual Activity prefetches transactions": "onHover={() => prefetchScreen('transactions')}" in individual,
    "business Activity prefetches transactions": "onPrefetch={() => prefetchScreen('transactions')}" in business,
}

for name, ok in checks.items():
    print(f"[{'OK' if ok else 'FAIL'}] {name}")
raise SystemExit(0 if all(checks.values()) else 1)
