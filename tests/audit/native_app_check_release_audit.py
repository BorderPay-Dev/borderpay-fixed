#!/usr/bin/env python3
from pathlib import Path


def require(path: str, needle: str) -> None:
    text = Path(path).read_text()
    if needle not in text:
        raise SystemExit(f"Missing native App Check invariant in {path}: {needle}")


require("package.json", '"@capacitor-firebase/app-check": "8.5.1"')
require("capacitor.config.ts", "'@capacitor-firebase/app-check'")
require("capacitor.config.ts", "'@capacitor-firebase/app-check': { symlink: true }")
require("utils/security/firebaseAppCheck.ts", "FirebaseAppCheck.initialize")
require("utils/security/firebaseAppCheck.ts", "isTokenAutoRefreshEnabled: true")
require("utils/security/firebaseAppCheck.ts", "FirebaseAppCheck.getToken")
require("utils/security/firebaseAppCheck.ts", "if (!isNativeRuntime()) return undefined")
require("utils/security/firebaseAppCheck.ts", "Native app attestation unavailable")
require("utils/api/backendAPI.ts", "'X-Firebase-AppCheck': appCheckToken")
require(".github/workflows/ios-testflight.yml", "IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64")
require(".github/workflows/ios-testflight.yml", "FirebaseAppCheckPlugin")
require("ios/App/App.xcodeproj/project.pbxproj", "GoogleService-Info.plist in Resources")
require(".github/workflows/ios-testflight.yml", "Verify Firebase configuration in archived app")
require(".github/workflows/ios-testflight.yml", "Products/Applications/App.app/GoogleService-Info.plist")
require(".github/workflows/android-play.yml", "ANDROID_GOOGLE_SERVICES_JSON_BASE64")
require(".github/workflows/android-play.yml", "firebase-appcheck-playintegrity")
require("android/app/src/main/java/com/borderpayafrica/app/MainActivity.java", "FirebaseApp.initializeApp(this)")
require("android/app/src/main/java/com/borderpayafrica/app/MainActivity.java", "super.onCreate(savedInstanceState)")
require("android/app/build.gradle", 'implementation "com.google.firebase:firebase-appcheck-playintegrity:$firebaseAppCheckPlayIntegrityVersion"')
require("android/variables.gradle", "firebaseAppCheckPlayIntegrityVersion = '19.0.1'")

for path in ("utils/security/firebaseAppCheck.ts", ".github/workflows/ios-testflight.yml", ".github/workflows/android-play.yml"):
    text = Path(path).read_text()
    if "debugToken: true" in text or "debug: true" in text:
        raise SystemExit(f"Release App Check debug provider is forbidden: {path}")

print("PASS: native App Check release invariants")
