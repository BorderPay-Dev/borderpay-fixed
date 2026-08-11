#!/usr/bin/env python3
"""Fail store releases when native packages contain stale customer UI."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"


def asset_references(index: Path) -> set[str]:
    html = index.read_text(encoding="utf-8")
    return set(re.findall(r'(?:src|href)="/?([^"?#]+)', html))


def assert_native_matches_dist(platform_public: Path) -> None:
    assert (DIST / "index.html").exists(), "Run npm run build before this audit"
    assert (platform_public / "index.html").exists(), "Run capacitor sync before this audit"
    refs = asset_references(DIST / "index.html")
    assert refs, "Built index contains no asset references"
    for rel in refs:
        dist_asset = DIST / rel
        native_asset = platform_public / rel
        if not dist_asset.is_file():
            continue
        assert native_asset.is_file(), f"Native package is missing current asset: {rel}"
        assert native_asset.read_bytes() == dist_asset.read_bytes(), f"Native package contains stale asset: {rel}"


dashboard = (ROOT / "components/app/Dashboard.tsx").read_text(encoding="utf-8")
main_app = (ROOT / "components/app/MainApp.tsx").read_text(encoding="utf-8")
for forbidden in (
    "ExchangeRateWidget",
    "DashboardRateWidget",
    "Exchange Activity",
    "handleNavigate('exchange')",
    "onNavigate('exchange')",
):
    assert forbidden not in dashboard, f"Customer dashboard exposes forbidden exchange surface: {forbidden}"

assert "case 'exchange':" in main_app and "return 'dashboard';" in main_app[
    main_app.index("case 'exchange':"):
], "Legacy exchange links must resolve to the dashboard"

compiled = "\n".join(
    path.read_text(encoding="utf-8", errors="ignore")
    for path in (DIST / "assets").glob("*.js")
)
for forbidden in (
    "Foreign Exchange coming soon",
    "Current exchange rate unavailable",
    "Exchange Activity",
):
    assert forbidden not in compiled, f"Compiled store bundle contains forbidden exchange UI: {forbidden}"

platform = sys.argv[1] if len(sys.argv) > 1 else "all"
assert platform in {"android", "ios", "all"}, "Usage: store_release_bundle_audit.py [android|ios]"
if platform in {"android", "all"}:
    assert_native_matches_dist(ROOT / "android/app/src/main/assets/public")
if platform in {"ios", "all"}:
    assert_native_matches_dist(ROOT / "ios/App/App/public")

styles = (ROOT / "android/app/src/main/res/values/styles.xml").read_text(encoding="utf-8")
assert 'windowSplashScreenAnimatedIcon">@drawable/splash_transparent' in styles
assert 'android:background">@drawable/splash' not in styles

print("Store release bundle audit passed")
