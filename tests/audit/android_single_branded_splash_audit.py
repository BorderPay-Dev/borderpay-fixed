from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
styles = (ROOT / "android/app/src/main/res/values/styles.xml").read_text()
transparent_icon = (
    ROOT / "android/app/src/main/res/drawable/splash_transparent.xml"
).read_text()

checks = {
    "Android native frame does not render the branded splash drawable": (
        '<item name="android:background">@drawable/splash</item>' not in styles
    ),
    "Android native frame uses the neutral BorderPay background": (
        '<item name="windowSplashScreenBackground">#0B0E11</item>' in styles
    ),
    "Android launch icon is transparent": (
        'windowSplashScreenAnimatedIcon">@drawable/splash_transparent' in styles
        and '@android:color/transparent' in transparent_icon
    ),
    "Android switches to the normal app theme after launch": (
        '<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>' in styles
    ),
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit(
        "Android single branded splash audit failed: " + "; ".join(failed)
    )

print(f"Android single branded splash audit passed ({len(checks)}/{len(checks)})")
