#!/usr/bin/env python3
"""Run the release-critical iOS/Android source regression suite."""

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
AUDITS = (
    "android_native_auth_audit.py",
    "android_native_launch_and_listing_audit.py",
    "android_media_permissions_audit.py",
    "ios_native_biometric_release_audit.py",
    "app_lock_audit.py",
    "app_lock_legacy_pin_regression_audit.py",
    "app_lock_no_logout_audit.py",
    "app_unlock_state_cleanup_audit.py",
    "biometric_button_availability_audit.py",
    "biometric_login_session_first_audit.py",
    "native_receipt_export_audit.py",
    "native_transaction_push_audit.py",
    "capacitor_viewport_audit.py",
    "business_mobile_regression_audit.py",
    "app_store_exchange_navigation_audit.py",
    "signup_hosted_verification_handoff_audit.py",
    "signup_phone_optional_app_review_audit.py",
    "direct_business_signup_store_audit.py",
    "password_recovery_routing_audit.py",
    "kyc_path_canonical_audit.py",
    "kyc_tos_warning_audit.py",
    "african_rails_closed_beta_gate_audit.py",
    "african_rails_customer_ui_audit.py",
    "current_access_model_regression_audit.py",
)

for audit in AUDITS:
    path = ROOT / "tests/audit" / audit
    if not path.is_file():
        raise SystemExit(f"Missing mobile release audit: {path.relative_to(ROOT)}")
    result = subprocess.run([sys.executable, str(path)], cwd=ROOT)
    if result.returncode:
        raise SystemExit(result.returncode)

print(f"Mobile store source audit passed ({len(AUDITS)} gates)")
