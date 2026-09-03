#!/usr/bin/env python3
"""Ensure Android uses a neutral launch frame then one branded web splash."""

from pathlib import Path


root = Path(__file__).resolve().parents[2]
app = (root / "App.tsx").read_text()
html = (root / "index.html").read_text()
styles = (root / "android/app/src/main/res/values/styles.xml").read_text()
transparent = (
    root / "android/app/src/main/res/drawable/splash_transparent.xml"
).read_text()

assert "if (isNativeRuntime()) return true" not in app, "branded React splash is suppressed on native"
assert ".native-runtime #initial-splash" not in html, "branded HTML splash is suppressed on native"
assert 'parent="Theme.SplashScreen"' in styles, "Android OS launch theme is missing"
assert '<item name="android:background">@drawable/splash</item>' not in styles, (
    "Capacitor splash artwork is still configured as the native launch frame"
)
assert '<item name="windowSplashScreenBackground">#0B0E11</item>' in styles
assert 'windowSplashScreenAnimatedIcon">@drawable/splash_transparent' in styles
assert '@android:color/transparent' in transparent
assert '<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>' in styles

print("Native single-splash audit: PASS")
