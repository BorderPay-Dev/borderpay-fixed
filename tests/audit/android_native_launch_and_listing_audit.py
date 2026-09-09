from pathlib import Path

root = Path(__file__).resolve().parents[2]
app = (root / "App.tsx").read_text()
html = (root / "index.html").read_text()
workflow = (root / ".github/workflows/android-play.yml").read_text()
manifest = (root / "android/app/src/main/AndroidManifest.xml").read_text()
strings = (root / "android/app/src/main/res/values/strings.xml").read_text()

assert "useState(() => !skipSplashOnce)" in app
assert "const showSplashScreen = (" in app
assert ".native-app #initial-splash" in html
assert "nativePlatform === 'android' || nativePlatform === 'ios'" in html
styles = (root / "android/app/src/main/res/values/styles.xml").read_text()
assert "windowSplashScreenAnimatedIcon\">@drawable/splash_transparent" in styles
assert (root / "android/app/src/main/res/drawable/splash_transparent.xml").exists()
assert "serviceAccountJsonPlainText" in workflow
assert "fastlane supply" in workflow
assert "public/icons/icon-512x512.png" in workflow
assert "--track internal" in workflow
assert '--version_code "$BUILD_NUMBER"' in workflow
assert 'android:icon="@mipmap/ic_launcher"' in manifest
assert '<string name="app_name">BorderPay</string>' in strings
listing_root = root / "android/fastlane/metadata/android/en-US"
title = (listing_root / "title.txt").read_text().strip()
short_description = (listing_root / "short_description.txt").read_text().strip()
full_description = (listing_root / "full_description.txt").read_text().strip()
assert title == "BorderPay - Mobile Finance"
assert short_description
assert full_description
assert "Direct BorderPay signup is for businesses" in full_description
assert "for individuals and businesses" not in full_description.lower()

print("Android native launch and Google Play listing gates passed.")
