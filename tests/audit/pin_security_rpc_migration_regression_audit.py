from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = (ROOT / "supabase/migrations/20260619103000_security_abuse_and_reconciliation_hardening.sql").read_text()
HOTFIX = (ROOT / "supabase/migrations/20260806184500_restore_pin_security_rpcs.sql").read_text()

failures = []
for name in ("set_user_pin_v2", "verify_user_pin_atomic", "change_user_pin_atomic"):
    if f"function public.{name}" not in HOTFIX:
        failures.append(f"hotfix does not restore {name}")

bad_signature = "p_candidate_hash_legacy text default null,\n  p_new_hash_v2 text,"
if bad_signature in BASE or bad_signature in HOTFIX:
    failures.append("change PIN RPC has a required argument after defaulted arguments")
if "p_new_hash_v2 text default null" not in BASE or "p_new_hash_v2 text default null" not in HOTFIX:
    failures.append("change PIN RPC clean-replay signature is not valid PostgreSQL")
if "grant execute on function public.verify_user_pin_atomic" not in HOTFIX:
    failures.append("verify PIN RPC is not granted to service_role")

if failures:
    print("pin_security_rpc_migration_regression_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("pin_security_rpc_migration_regression_audit: PASS")
