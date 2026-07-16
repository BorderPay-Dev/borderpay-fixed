#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "[safety-boundary] ERROR: $1" >&2
  exit 1
}

echo "[safety-boundary] enforcing repository and lifecycle execution boundaries..."

HAS_RG=true
if ! command -v rg >/dev/null 2>&1; then
  HAS_RG=false
  echo "[safety-boundary] WARN: rg not found; using grep fallback for boundary scans."
fi

scan_rg() {
  if [ "$HAS_RG" = true ]; then
    rg "$@"
  else
    return 0
  fi
}

# 1) /scripts/sql must not contain lifecycle mutation logic.
if [ -d "$ROOT/scripts/sql" ]; then
  SQL_HITS="$(scan_rg -n -S \
    -e "create\\s+or\\s+replace\\s+function\\s+public\\.(ingest_bridge_event|claim_pending_events|complete_pending_event|fail_pending_event)\\b" \
    -e "update\\s+public\\.(pending_events|webhook_logs|bridge_webhook_events)\\b" \
    "$ROOT/scripts/sql" --glob '*.sql' || true)"
  if [ -n "$SQL_HITS" ]; then
    echo "$SQL_HITS" >&2
    fail "Lifecycle mutation logic is forbidden in /scripts/sql."
  fi
fi

# 2) Block incident SQL references unless INCIDENT_MODE=true.
#    Reference outside scripts/incident is considered runnable-path risk.
if [ "${INCIDENT_MODE:-false}" != "true" ]; then
  INCIDENT_REFS="$(scan_rg -n -S "scripts/incident/sql/|scripts/incident/" \
    "$ROOT" \
    --glob '!.git/**' \
    --glob '!node_modules/**' \
    --glob '!scripts/incident/**' \
    --glob '!**/scripts/incident/**' \
    --glob '!scripts/ci/enforce-safety-boundaries.sh' \
    --glob '!**/scripts/ci/enforce-safety-boundaries.sh' \
    --glob '!docs/**' \
    --glob '!**/*.md' \
    --glob '!**/*.txt' || true)"
  if [ -n "$INCIDENT_REFS" ]; then
    echo "$INCIDENT_REFS" >&2
    fail "Incident-only SQL is referenced outside incident mode (set INCIDENT_MODE=true only for approved incidents)."
  fi
fi

# 3) Guard non-canonical SQL execution paths from lifecycle-state mutation.
#    Allowed SQL locations for lifecycle mutation logic:
#      - supabase/migrations/** (historical canonical RPC definitions)
#      - scripts/incident/** (quarantined incident-only tools)
#    Everywhere else: forbidden.
NON_CANONICAL_HITS="$(scan_rg -n -S \
  -e "create\\s+or\\s+replace\\s+function\\s+public\\.(ingest_bridge_event|claim_pending_events|complete_pending_event|fail_pending_event)\\b" \
  -e "update\\s+public\\.(pending_events|webhook_logs|bridge_webhook_events)\\b" \
  "$ROOT" --glob '*.sql' \
  --glob '!supabase/migrations/**' \
  --glob '!**/supabase/migrations/**' \
  --glob '!scripts/incident/**' \
  --glob '!**/scripts/incident/**' \
  --glob '!scripts/sql/**' \
  --glob '!**/scripts/sql/**' \
  --glob '!.git/**' \
  --glob '!node_modules/**' || true)"
if [ -n "$NON_CANONICAL_HITS" ]; then
  echo "$NON_CANONICAL_HITS" >&2
  fail "Lifecycle mutation SQL found outside canonical RPC/function layer."
fi

# 4) Ingress decision boundary guards.
#    a) Evaluator must stay pure (no DB/network/time side effects).
EVAL_FILE="$ROOT/supabase/functions/_shared/bridge-ingress-evaluator.ts"
if [ -f "$EVAL_FILE" ]; then
  EVAL_IMPURE_HITS="$(scan_rg -n -S \
    -e "\\.from\\(" \
    -e "\\.rpc\\(" \
    -e "fetch\\(" \
    -e "Date\\.now\\(" \
    -e "new\\s+Date\\(" \
    "$EVAL_FILE" || true)"
  if [ -n "$EVAL_IMPURE_HITS" ]; then
    echo "$EVAL_IMPURE_HITS" >&2
    fail "bridge-ingress-evaluator.ts must remain pure and side-effect free."
  fi
fi

#    b) Routing pattern branching must not be duplicated outside evaluator.
ROUTING_BRANCH_HITS="$(scan_rg -n -S \
  -e "startsWith\\(\"(kyc_link\\.|customer\\.kyc|customer\\.kyb|virtual_account\\.|wallet\\.|bridge_wallet\\.|external_account\\.|transfer\\.|payout\\.|deposit\\.|customer\\.)" \
  "$ROOT/supabase/functions/bridge-webhook/index.ts" \
  "$ROOT/supabase/functions/bridge-test-webhook/index.ts" \
  "$ROOT/supabase/functions/process-pending-events/index.ts" || true)"
if [ -n "$ROUTING_BRANCH_HITS" ]; then
  echo "$ROUTING_BRANCH_HITS" >&2
  fail "Ingress/worker routing prefixes must be derived from bridge-ingress-evaluator only."
fi

# 5) Block direct lifecycle status updates outside canonical mutation surfaces.
#    Current temporary allowlist is explicit and must trend to zero.
DIRECT_TS_UPDATES="$(scan_rg -n -S \
  -e "from\\(\"pending_events\"\\)\\s*\\.update\\(" \
  -e "from\\(\"bridge_webhook_events\"\\)\\s*\\.update\\(" \
  -e "from\\(\"bridge_transfers\"\\)\\s*\\.update\\(" \
  "$ROOT/supabase/functions" --glob '*.ts' || true)"
if [ -n "$DIRECT_TS_UPDATES" ]; then
  if [ "$HAS_RG" = true ]; then
    UNAPPROVED_TS_UPDATES="$(printf '%s\n' "$DIRECT_TS_UPDATES" | rg -v \
      -e "supabase/functions/process-pending-events/index.ts" \
      -e "supabase/functions/bridge-test-webhook/index.ts" || true)"
  else
    UNAPPROVED_TS_UPDATES="$(printf '%s\n' "$DIRECT_TS_UPDATES" | grep -Ev \
      -e "supabase/functions/process-pending-events/index.ts" \
      -e "supabase/functions/bridge-test-webhook/index.ts" || true)"
  fi
  if [ -n "$UNAPPROVED_TS_UPDATES" ]; then
    echo "$UNAPPROVED_TS_UPDATES" >&2
    fail "Direct lifecycle table UPDATE found outside approved mutation surfaces."
  fi
fi

DIRECT_SQL_UPDATES="$(scan_rg -n -S \
  -e "update\\s+public\\.(pending_events|bridge_webhook_events|bridge_transfers)\\b" \
  "$ROOT" --glob '*.sql' \
  --glob '!supabase/migrations/**' \
  --glob '!**/supabase/migrations/**' \
  --glob '!scripts/incident/**' \
  --glob '!**/scripts/incident/**' \
  --glob '!.git/**' \
  --glob '!node_modules/**' || true)"
if [ -n "$DIRECT_SQL_UPDATES" ]; then
  echo "$DIRECT_SQL_UPDATES" >&2
  fail "Direct lifecycle SQL UPDATE found outside migrations/incident boundaries."
fi

# 6) Exhaustiveness gate: every lifecycle-table write path must be classified.
python3 "$ROOT/scripts/ci/verify_lifecycle_write_path_exhaustiveness.py" --phase A >/dev/null \
  || fail "Lifecycle write-path exhaustiveness check failed."

# 7) Runtime lifecycle lock objective:
#    - zero runtime lifecycle writes on blocked tables
#    - bridge_webhook_events direct writes restricted to allowlisted columns
python3 "$ROOT/scripts/ci/verify_lifecycle_write_path_exhaustiveness.py" --phase C --runtime-only >/dev/null \
  || fail "Lifecycle runtime lock objective failed (phase C)."

# 8) Legacy-runtime guards:
#    a) banned legacy endpoint aliases must never be reintroduced in app API calls.
if [ -f "$ROOT/scripts/ci/verify_no_legacy_endpoint_aliases.py" ]; then
  python3 "$ROOT/scripts/ci/verify_no_legacy_endpoint_aliases.py" >/dev/null \
    || fail "Legacy endpoint alias guard failed."
fi

#    b) prohibited legacy stablecoin symbols must never leak into runtime code.
if [ -f "$ROOT/scripts/ci/verify_no_legacy_stablecoins.py" ]; then
  python3 "$ROOT/scripts/ci/verify_no_legacy_stablecoins.py" >/dev/null \
    || fail "Legacy stablecoin runtime guard failed."
fi

# 9) Product availability + dashboard wallet-chip regression guards.
python3 "$ROOT/tests/audit/bridge_country_policy_audit.py" >/dev/null \
  || fail "Bridge country policy / ISO-3 normalization audit failed."

python3 "$ROOT/tests/audit/dashboard_spendable_wallet_chips_audit.py" >/dev/null \
  || fail "Dashboard spendable wallet chip audit failed."

python3 "$ROOT/tests/audit/current_access_model_regression_audit.py" >/dev/null \
  || fail "Current access model regression audit failed."

# 10) Pricing route/runtime guard:
#    PricingScreen and /pricing route are retired. Any reintroduction must fail CI.
if [ -f "$ROOT/components/pricing/PricingScreen.tsx" ]; then
  fail "Retired PricingScreen.tsx reintroduced."
fi

if [ "$HAS_RG" = true ]; then
  PRICING_ROUTE_HITS="$(rg -n -S "\\bpricing\\b" \
    "$ROOT/components/app/MainApp.tsx" \
    "$ROOT/components/shell/AppShell.tsx" \
    "$ROOT/components/app/Dashboard.tsx" \
    "$ROOT/components/business/BusinessDashboard.tsx" \
    "$ROOT/components/team/TeamScreen.tsx" || true)"
else
  PRICING_ROUTE_HITS="$(grep -nE "\\bpricing\\b" \
    "$ROOT/components/app/MainApp.tsx" \
    "$ROOT/components/shell/AppShell.tsx" \
    "$ROOT/components/app/Dashboard.tsx" \
    "$ROOT/components/business/BusinessDashboard.tsx" \
    "$ROOT/components/team/TeamScreen.tsx" || true)"
fi
if [ -n "$PRICING_ROUTE_HITS" ]; then
  echo "$PRICING_ROUTE_HITS" >&2
  fail "Retired pricing route/runtime references detected."
fi

echo "[safety-boundary] OK"
