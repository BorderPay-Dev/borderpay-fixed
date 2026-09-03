#!/usr/bin/env python3
"""Protect business-dashboard recent activity placement and navigation."""

from pathlib import Path


source = (Path(__file__).resolve().parents[2] / "components/business/BusinessDashboard.tsx").read_text()

treasury = source.index("<TreasuryCard")
recent = source.index('data-testid="business-recent-activity"')
assert recent > treasury, "business recent activity must render below TreasuryCard"
assert "transactions.slice(0, 5).map" in source, "business recent activity must be bounded"
assert "navigate('transactions')" in source, "business recent activity must open transaction history"
assert "sanitizeCustomerFacingText" in source, "provider names must be sanitized in customer-facing activity"

print("Business dashboard recent activity audit: PASS")
