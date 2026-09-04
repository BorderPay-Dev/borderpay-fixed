#!/usr/bin/env bash
set -euo pipefail

gate() {
  local number="$1"
  local name="$2"
  shift 2
  echo "[store-release] gate ${number}/10: ${name}"
  "$@"
}

gate 1 "repository and lifecycle boundaries" \
  bash scripts/ci/enforce-safety-boundaries.sh
git diff --check

gate 2 "TypeScript compilation" npm run type-check

echo "[store-release] gate 3/10: direct signup is Business-only"
python3 tests/audit/direct_business_signup_store_audit.py
python3 tests/audit/signup_compliance_release_audit.py
python3 tests/audit/signup_country_enforcement_audit.py
python3 tests/audit/signup_phone_optional_app_review_audit.py

echo "[store-release] gate 4/10: exactly one branded native launch experience"
python3 tests/audit/native_single_splash_audit.py

echo "[store-release] gate 5/10: Android system-picker permissions"
python3 tests/audit/android_media_permissions_audit.py

echo "[store-release] gate 6/10: iOS native launch configuration"
python3 tests/audit/ios_native_launch_config_audit.py

echo "[store-release] gate 7/10: app-lock restores the exact prior screen"
python3 tests/audit/app_lock_audit.py
python3 tests/audit/app_lock_no_logout_audit.py
python3 tests/audit/app_lock_screen_restore_audit.py

echo "[store-release] gate 8/10: native safe areas and viewport"
python3 tests/audit/native_notification_safe_area_audit.py
python3 tests/audit/capacitor_viewport_audit.py

echo "[store-release] gate 9/10: EEA-only SCA and non-EEA access"
python3 tests/audit/non_eea_sca_scope_audit.py
python3 tests/audit/native_store_sca_and_subscription_audit.py

echo "[store-release] gate 10/10: Business dashboard and financial UI"
python3 tests/audit/business_dashboard_recent_activity_audit.py
python3 tests/audit/business_mobile_regression_audit.py
python3 tests/audit/free_external_wallet_preview_audit.py
python3 tests/audit/app_store_exchange_navigation_audit.py
python3 tests/audit/public_provider_privacy_audit.py
npm run build

echo "[store-release] all 10 gates passed"
