#!/usr/bin/env python3
"""
Current access model regression audit.

BorderPay's live customer model is:
- no upfront paid plan, activation fee, or upgrade funnel;
- verified accounts have a monthly infrastructure-maintenance subscription;
- individual and business users verify with KYC/KYB to unlock accounts;
- verified users must not see the verify-your-identity/business dashboard prompt;
- "first transaction" reminders are retired in favor of request-account reminders.

This audit intentionally targets customer-facing/runtime surfaces and gate code.
It does not ban legacy database/table names in migrations because those remain
for compatibility.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CUSTOMER_SURFACE_PATHS = [
    ROOT / "components",
    ROOT / "src",
    ROOT / "utils/i18n",
    ROOT / "supabase/functions/_shared/email-templates",
    ROOT / "docs/api",
]

BANNED_CUSTOMER_PHRASES = [
    "receive first funds",
    "unlock your accounts automatically",
    "first transaction reminder",
    "activation fee",
    "paid plan",
    "paid plans",
    "plan required",
    "subscription required",
    "upgrade to global wallet",
    "upgrade your account",
]

TEXT_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".md",
    ".json",
    ".yaml",
    ".yml",
}


def fail(message: str) -> None:
    print("FAIL: current access model regression audit")
    print()
    print(message)
    sys.exit(1)


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"^\s*//[^\n]*\n", "\n", src, flags=re.MULTILINE)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def iter_surface_files() -> list[Path]:
    files: list[Path] = []
    for base in CUSTOMER_SURFACE_PATHS:
        if not base.exists():
            continue
        if base.is_file():
            files.append(base)
            continue
        for path in base.rglob("*"):
            if path.is_file() and path.suffix in TEXT_EXTENSIONS:
                files.append(path)
    return files


def assert_no_legacy_customer_copy() -> None:
    findings: list[str] = []
    for path in iter_surface_files():
        text = strip_comments(read(path)).lower()
        for phrase in BANNED_CUSTOMER_PHRASES:
            if phrase in text:
                findings.append(f"{path.relative_to(ROOT)}: banned customer phrase '{phrase}'")
    if findings:
        fail("legacy paid-plan/activation/first-transaction copy found:\n" + "\n".join(f"  - {f}" for f in findings))


def assert_verified_users_do_not_see_verification_prompts() -> None:
    dash = read(ROOT / "components/app/Dashboard.tsx")
    biz = read(ROOT / "components/business/BusinessDashboard.tsx")
    env = read(ROOT / "utils/config/environment.ts")

    required_dashboard_markers = [
        "verificationResolved && !isVerified && (",
        "open={verificationResolved && !isVerified}",
    ]
    for marker in required_dashboard_markers:
        if marker not in dash:
            fail(f"individual dashboard must gate verification prompt behind resolved unverified state: missing {marker}")

    banned_dashboard_markers = [
        "open={!isVerified}",
        "open={ !isVerified",
        "{!isVerified && (",
    ]
    for marker in banned_dashboard_markers:
        if marker in dash:
            fail(f"individual dashboard has an unsafe verification prompt gate: {marker}")

    if "verificationResolved && !kybVerified && (" not in biz:
        fail("business dashboard must gate KYB prompt behind verificationResolved && !kybVerified")
    if "{!kybVerified && (" in biz:
        fail("business dashboard has an unsafe KYB prompt gate without verificationResolved")

    for marker in [
        "if (bridgeKyc === 'approved') return 'verified';",
        "if (isFullEnrollment(legacy)) return 'verified';",
        "return deriveKycStatus(profile) === 'verified';",
    ]:
        if marker not in env:
            fail(f"verification parser must preserve approved/legacy verified users: missing {marker}")


def assert_no_upfront_paid_plan_gates() -> None:
    plans = read(ROOT / "utils/subscriptions/plans.ts")
    gate = read(ROOT / "utils/subscriptions/gate.ts")
    launch = read(ROOT / "supabase/functions/_shared/launch-gates.ts")
    money_gate = read(ROOT / "components/subscriptions/MoneyMovementGate.tsx")

    non_zero_activation_fees = re.findall(r"activation_fee_usd:\s*(?!0\b)(\d+)", plans)
    if non_zero_activation_fees:
        fail(f"all activation_fee_usd values must remain 0; found {non_zero_activation_fees}")

    for marker in [
        "return true;",
        "export function requiresPaidPlan",
        "return false;",
        "export function canMoveMoney",
        "export function canStartVerification",
        "export function isAccountActivated",
    ]:
        if marker not in gate:
            fail(f"frontend subscription compatibility gate must stay no-op: missing {marker}")

    for marker in [
        'Deno.env.get("KYC_REQUIRES_PAYMENT") || "false"',
        "export function isPaidPlanKey",
        "return true;",
        "return { isPaidPlan: true };",
    ]:
        if marker not in launch:
            fail(f"backend verification gate must not require paid plan by default: missing {marker}")

    if "return <>{children}</>;" not in money_gate:
        fail("MoneyMovementGate must remain pass-through; no upgrade/paywall wrapper")
    for banned in ["onUpgrade()", "UpgradeModal", "PricingScreen"]:
        if banned in money_gate:
            fail(f"MoneyMovementGate reintroduced a paid-plan UI dependency: {banned}")


def assert_email_reminder_contract() -> None:
    templates = ROOT / "supabase/functions/_shared/email-templates"
    retired = list(templates.rglob("first-transaction-reminder.ts"))
    if retired:
        fail("retired first-transaction reminder template exists:\n" + "\n".join(f"  - {p.relative_to(ROOT)}" for p in retired))

    index = read(templates / "index.ts")
    for marker in [
        "./individual/request-account-reminder.ts",
        "./business/request-account-reminder.ts",
        '"individual.request_account_reminder"',
        '"business.request_account_reminder"',
        "individualRequestAccountReminder",
        "businessRequestAccountReminder",
    ]:
        if marker not in index:
            fail(f"request-account reminder template is not registered: missing {marker}")

    if "first_transaction_reminder" in index or "firstTransactionReminder" in index:
        fail("email template registry still exposes first transaction reminder")

    for path in [
        templates / "individual/request-account-reminder.ts",
        templates / "business/request-account-reminder.ts",
    ]:
        text = read(path).lower()
        if not any(phrase in text for phrase in ("request your account", "request your business account", "request your borderpay account")):
            fail(f"{path.relative_to(ROOT)} must use request-account reminder copy")
        if "first transaction" in text:
            fail(f"{path.relative_to(ROOT)} still uses first-transaction copy")


def main() -> int:
    assert_no_legacy_customer_copy()
    assert_verified_users_do_not_see_verification_prompts()
    assert_no_upfront_paid_plan_gates()
    assert_email_reminder_contract()

    print("PASS: current access model regression audit")
    print()
    print("  customer copy:       no paid-plan/activation/first-transaction funnel")
    print("  verification prompt: hidden for resolved verified users")
    print("  access gates:        no upfront paid plan required")
    print("  email reminders:     request-account reminder registered; first-transaction retired")
    return 0


if __name__ == "__main__":
    sys.exit(main())
