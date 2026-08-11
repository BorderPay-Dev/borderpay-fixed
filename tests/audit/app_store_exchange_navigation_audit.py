#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
dashboard = (ROOT / 'components/app/Dashboard.tsx').read_text()
business = (ROOT / 'components/business/BusinessDashboard.tsx').read_text()
flags = (ROOT / 'utils/featureFlags.ts').read_text()
main_app = (ROOT / 'components/app/MainApp.tsx').read_text()
review_demo = (ROOT / 'utils/review/appReviewDemoBootstrap.ts').read_text()
terms = (ROOT / 'components/legal/TermsOfServiceScreen.tsx').read_text()

hero = dashboard[dashboard.index('{/* Circular action buttons'):dashboard.index('{/* ── 5. Setup checklist')]
assert "handleNavigate('exchange')" not in hero
assert "handleNavigate('transactions')" in hero
assert "dashboard.recentActivity" in hero
assert "export const FX_RUNTIME_ENABLED: boolean = false;" in flags
assert "export const FX_NAV_ENABLED: boolean = false;" in flags

# Exchange must remain unreachable even if certification state changes or a
# reviewer opens a legacy deep link directly.
assert "import { ExchangeScreen }" not in main_app
assert "| 'exchange'" not in main_app
assert "case 'exchange':\n      // Legacy links" in main_app
assert "return 'dashboard';" in main_app[main_app.index("case 'exchange':"):]

reachable_surfaces = "\n".join((dashboard, business, main_app))
assert "onNavigate('exchange')" not in reachable_surfaces
assert "navigate('exchange')" not in reachable_surfaces
assert "prefetchScreen('exchange')" not in reachable_surfaces
assert "ExchangeRateWidget" not in reachable_surfaces
assert "'exchange', 150" not in review_demo
assert "Currency Exchange:" not in terms

print('App Store exchange navigation audit passed')
