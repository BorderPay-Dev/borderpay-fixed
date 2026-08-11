from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = (ROOT / "package.json").read_text()
CLIENT = (ROOT / "utils/notifications/nativePush.ts").read_text()
MIGRATION = (ROOT / "supabase/migrations/20260811021000_native_transaction_push.sql").read_text()
WORKER = (ROOT / "supabase/functions/push-delivery-worker/index.ts").read_text()
MAIN = (ROOT / "components/app/MainApp.tsx").read_text()
APP = (ROOT / "App.tsx").read_text()
ENTITLEMENTS = (ROOT / "ios/App/App/App.entitlements").read_text()
SUPABASE_CONFIG = (ROOT / "supabase/config.toml").read_text()


def main() -> None:
    failures: list[str] = []
    checks = {
        "Firebase messaging dependency": '"@capacitor-firebase/messaging"' in PACKAGE,
        "native FCM token registration": "FirebaseMessaging.getToken()" in CLIENT,
        "permission request": "FirebaseMessaging.requestPermissions()" in CLIENT,
        "token ownership RPC": "register_push_device" in CLIENT,
        "logout token revocation": "unregisterNativePush" in APP and "deleteToken" in CLIENT,
        "notification tap transaction route": "notificationActionPerformed" in CLIENT and "navigateTo('transactions')" in MAIN,
        "iOS push entitlement": "aps-environment" in ENTITLEMENTS,
        "transaction-only queue": "new.type::text <> 'transaction'" in MIGRATION,
        "privacy-safe body": "Open BorderPay to view transaction details." in MIGRATION,
        "idempotent notification queue": "unique(notification_id)" in MIGRATION,
        "locked queue claim": "for update skip locked" in MIGRATION,
        "FCM HTTP v1": "fcm.googleapis.com/v1/projects" in WORKER,
        "authenticated Firebase credential health check": "verify_credentials" in WORKER,
        "cron worker bypasses platform JWT gateway": "[functions.push-delivery-worker]\nverify_jwt = false" in SUPABASE_CONFIG,
        "server credential secret": "FIREBASE_SERVICE_ACCOUNT_JSON" in WORKER,
        "invalid-token revocation": "UNREGISTERED" in WORKER,
    }
    failures.extend(label for label, ok in checks.items() if not ok)
    if failures:
        raise SystemExit("\n".join(f"FAIL: {failure}" for failure in failures))
    print("PASS: native transaction push registration, privacy, queue, retry, and delivery are wired")


if __name__ == "__main__":
    main()
