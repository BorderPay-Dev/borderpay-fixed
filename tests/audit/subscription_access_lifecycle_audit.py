#!/usr/bin/env python3
"""Fail closed when maintenance access enforcement loses its safety rails."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


checks = {
    "provider actions are durable and idempotent": all(
        token in read("supabase/migrations/20260904130000_subscription_access_enforcement.sql")
        for token in (
            "subscription_provider_access_actions",
            "idempotency_key text not null unique",
            "p_dry_run boolean default true",
            "stale_processing_claim_recovered",
        )
    ),
    "day seven restricts pending and failed invoices": all(
        token in read("supabase/migrations/20260904130000_subscription_access_enforcement.sql")
        for token in ("payment_status in ('failed','pending')", "interval '7 days'", "account_access_restricted")
    ),
    "provider enforcement defaults off": all(
        token in read("supabase/functions/subscription-billing-worker/index.ts")
        for token in ("subscription_access_enforcement_enabled", "if (!(await accessEnforcementEnabled()))")
    ),
    "provider calls use cycle idempotency keys": all(
        token in read("supabase/functions/subscription-billing-worker/index.ts")
        for token in ("action.idempotency_key", "deactivateVirtualAccount", "reactivateVirtualAccount")
    ),
    "provider response is reduced before persistence": "provider_response: providerResult" not in read(
        "supabase/functions/subscription-billing-worker/index.ts"
    ),
    "restricted UI is explicit and outage-safe": all(
        token in read("components/app/MainApp.tsx")
        for token in (
            "SUBSCRIPTION_RESTRICTED_SCREENS",
            "Account maintenance payment required",
            "Fail open on read outages",
        )
    ),
    "wallet mutation is blocked server-side": all(
        token in read("supabase/functions/bridge-wallet/index.ts")
        for token in ("subscription_feature_restricted", "subscription_payment_required")
    ),
    "single and bulk transfers are blocked server-side": all(
        all(
            token in read(path)
            for token in ("subscription_feature_restricted", "subscription_payment_required")
        )
        for path in (
            "supabase/functions/bridge-transfer/index.ts",
            "supabase/functions/bridge-bulk-payout/index.ts",
        )
    ),
    "restricted UI blocks all wallet money movement": all(
        token in read("components/app/MainApp.tsx")
        for token in (
            "'send-money'",
            "'receive-money'",
            "'wallet-detail'",
            "'external-accounts'",
            "'bulk-payout'",
        )
    ),
    "subscription lifecycle is scheduled without embedded secrets": all(
        token in read("supabase/migrations/20260904143000_subscription_lifecycle_scheduler.sql")
        for token in (
            "subscription-billing-daily",
            "subscription-grace-daily",
            "subscription-delivery-drain",
            "subscription-webhook-drain",
            "public.app_config_get('worker_auth_token')",
        )
    ),
}

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(f"[{'OK' if passed else 'FAIL'}] {name}")
if failed:
    raise SystemExit(f"subscription_access_lifecycle_audit: FAIL ({len(failed)} checks)")
print(f"subscription_access_lifecycle_audit: PASS ({len(checks)}/{len(checks)})")
