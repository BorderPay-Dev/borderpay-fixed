from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = (ROOT / "utils/africanRailsPolicyCache.ts").read_text()
SEND = (ROOT / "components/send/SendMoneyFlow.tsx").read_text()
RECEIVE = (ROOT / "components/receive/ReceiveMoneyScreen.tsx").read_text()
CONFIG = (ROOT / "supabase/config.toml").read_text()
MIGRATION = (ROOT / "supabase/migrations/20260804121000_remove_flutterwave_runtime.sql").read_text()

failures = []
retired_paths = [
    "supabase/functions/_shared/providers/flutterwave.ts",
    "supabase/functions/_shared/providers/flutterwave-client.ts",
    "supabase/functions/flutterwave-account-resolve/index.ts",
    "supabase/functions/flutterwave-capabilities/index.ts",
    "supabase/functions/flutterwave-collection-create/index.ts",
    "supabase/functions/flutterwave-collection-status/index.ts",
    "supabase/functions/flutterwave-collections-list/index.ts",
    "supabase/functions/flutterwave-transfer-create/index.ts",
    "supabase/functions/flutterwave-transfer-rates/index.ts",
    "supabase/functions/flutterwave-transfer-status/index.ts",
    "supabase/functions/flutterwave-transfers-list/index.ts",
    "supabase/functions/flutterwave-webhook/index.ts",
    "supabase/functions/get-momo-providers/index.ts",
]
for path in retired_paths:
    if (ROOT / path).exists():
        failures.append(f"retired runtime file still exists: {path}")
if "functions.flutterwave" in CONFIG:
    failures.append("Supabase config still contains a Flutterwave function pin")
if "if (provider !== 'yellow_card') return;" not in CACHE:
    failures.append("frontend policy cache is not Yellow Card-only")
for label, source in [("send", SEND), ("receive", RECEIVE)]:
    if "selectedAfricanProvider !== 'flutterwave'" in source:
        failures.append(f"{label} still accepts Flutterwave as an active provider")
    if "? 'yellow_card' : 'flutterwave'" in source:
        failures.append(f"{label} still falls back to Flutterwave")
for token in [
    "where provider = 'flutterwave'",
    "drop table if exists public.flutterwave_webhook_events",
    "drop table if exists public.flutterwave_transfers",
    "provider in ('bridge', 'yellow_card')",
]:
    if token not in MIGRATION:
        failures.append(f"retirement migration missing: {token}")

if failures:
    print("flutterwave_retirement_audit: FAIL")
    for failure in failures:
        print(f" - {failure}")
    raise SystemExit(1)

print("flutterwave_retirement_audit: PASS")
