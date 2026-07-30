#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
repair = (ROOT / "supabase/functions/bridge-missing-customer-migration/index.ts").read_text()
verify = (ROOT / "supabase/functions/verify-email-token/index.ts").read_text()
resend = (ROOT / "supabase/functions/auth-resend-verification/index.ts").read_text()
config = (ROOT / "supabase/config.toml").read_text()

failures: list[str] = []

if "authUser.user.email_confirmed_at" not in repair:
    failures.append("repair function must check Supabase auth email_confirmed_at.")

if "verification_email_sent" not in repair or "issue_email_token" not in repair:
    failures.append("unconfirmed users missing Bridge IDs must receive a fresh verification token/email.")

if 'p_ip: null' not in repair or 'operator-repair' in repair:
    failures.append("operator verification repair must pass null IP, not a fake inet string.")

if "bridgeProvider.createCustomer" not in repair:
    failures.append("confirmed users missing Bridge IDs must be created through BridgeProvider.")

unconfirmed_idx = repair.find("if (!authUser.user.email_confirmed_at)")
bridge_idx = repair.find("bridgeProvider.createCustomer")
if unconfirmed_idx < 0 or bridge_idx < 0 or unconfirmed_idx > bridge_idx:
    failures.append("email-confirmation gate must run before Bridge customer creation.")

if "business_profiles" not in repair or ".update({ bridge_customer_id: created.provider_id" not in repair:
    failures.append("business Bridge customer IDs must sync to business_profiles too.")

if "include_all_missing" not in repair or '.is("bridge_customer_id", null)' not in repair:
    failures.append("operator repair must support discovering missing Bridge customers safely.")

if "operator_account" not in repair or '.eq("is_admin", false)' not in repair:
    failures.append("operator/admin accounts must be skipped from broad missing-customer repair.")

if "missing_country" not in repair or 'profile.country || "NG"' in repair:
    failures.append("missing country must be skipped; repair must not default live Bridge identity country.")

if "bridge_error" not in repair or "bridge_raw" not in repair:
    failures.append("Bridge repair failures must expose provider error details for operator cleanup.")

if "linked_existing" not in repair or "findCustomerByEmail" not in repair or "getCustomerProfile(existing.id)" not in repair:
    failures.append("existing Bridge customers must be linked by exact email and validated before local update.")

if "existing_bridge_customer_email_mismatch" not in repair:
    failures.append("existing Bridge customer link must fail closed on email mismatch.")

if "dryRun" not in repair or "would_send_verification" not in repair or "would_create" not in repair:
    failures.append("operator repair must support dry-run for both unverified and verified paths.")

pin = "[functions.bridge-missing-customer-migration]"
pin_idx = config.find(pin)
if pin_idx < 0 or "verify_jwt = false" not in config[pin_idx:pin_idx + 220]:
    failures.append("bridge-missing-customer-migration must be pinned verify_jwt=false; auth is enforced in-code.")

if "verify-email-token" not in verify or "ensureBridgeCustomerAfterEmailVerification" not in verify:
    failures.append("email verification must create/fetch the Bridge customer after signup verification.")

if "bridgeProvider.createCustomer" not in verify:
    failures.append("verify-email-token must call BridgeProvider for post-verification Bridge creation.")

if "auth-resend-verification" not in resend or "business.email_verification" not in resend:
    failures.append("resend verification flow must still send the correct verification templates.")

if failures:
    print("missing bridge customer repair audit failed:")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("missing bridge customer repair audit passed")
