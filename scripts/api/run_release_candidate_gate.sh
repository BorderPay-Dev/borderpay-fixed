#!/usr/bin/env bash
set -euo pipefail

# Step 2P: single-command release candidate gate pack.
#
# Required env:
#   SUPABASE_URL
#   SERVICE_ROLE_KEY
#   DRILL_MATRIX_JSON
#   TENANT_IDS
#
# Optional env:
#   RC_GATE_DIR                    default /tmp/api_rc_gate_<timestamp>
#   OPERATOR                       default unknown
#   CHANGE_REQUEST_ID              default n/a
#   EXECUTE_PROMOTION              true|false (default false)
#   PROMOTION_DRY_RUN              true|false (default true)
#   WATCHDOG_WINDOW_MINUTES        default 15
#   ALERT_ERROR_RATE_PCT           default 5
#   ALERT_P95_LATENCY_MS           default 2000
#   ALERT_PROVIDER_ERRORS          default 1
#   ALERT_RATE_LIMITED_REQUESTS    default 20
#   ALERT_MIN_REQUESTS             default 20

if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "SUPABASE_URL is required" >&2
  exit 1
fi
if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "SERVICE_ROLE_KEY is required" >&2
  exit 1
fi
if [[ -z "${DRILL_MATRIX_JSON:-}" ]]; then
  echo "DRILL_MATRIX_JSON is required" >&2
  exit 1
fi
if [[ -z "${TENANT_IDS:-}" ]]; then
  echo "TENANT_IDS is required" >&2
  exit 1
fi
if [[ ! -f "${DRILL_MATRIX_JSON}" ]]; then
  echo "DRILL_MATRIX_JSON not found: ${DRILL_MATRIX_JSON}" >&2
  exit 1
fi

STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
RC_GATE_DIR="${RC_GATE_DIR:-/tmp/api_rc_gate_${STAMP}}"
OPERATOR="${OPERATOR:-unknown}"
CHANGE_REQUEST_ID="${CHANGE_REQUEST_ID:-n/a}"
EXECUTE_PROMOTION="${EXECUTE_PROMOTION:-false}"
PROMOTION_DRY_RUN="${PROMOTION_DRY_RUN:-true}"
WATCHDOG_WINDOW_MINUTES="${WATCHDOG_WINDOW_MINUTES:-15}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$RC_GATE_DIR"

DRILL_OUT_DIR="${RC_GATE_DIR}/drill"
PROMOTION_OUT_DIR="${RC_GATE_DIR}/promotion"
WATCHDOG_PREFLIGHT_MD="${RC_GATE_DIR}/watchdog_preflight.md"
WATCHDOG_POST_MD="${RC_GATE_DIR}/watchdog_postflight.md"
GATE_REPORT="${RC_GATE_DIR}/RC_GATE_REPORT.md"

phase_fail() {
  local phase="$1"
  local code="$2"
  {
    echo
    echo "## Gate Status"
    echo
    echo "- result: FAILED"
    echo "- failed_phase: ${phase}"
    echo "- exit_code: ${code}"
  } >> "$GATE_REPORT"
  echo "RC gate failed at phase: ${phase}" >&2
  exit "$code"
}

{
  echo "# API Release Candidate Gate Report"
  echo
  echo "- timestamp_utc: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- operator: ${OPERATOR}"
  echo "- change_request_id: ${CHANGE_REQUEST_ID}"
  echo "- execute_promotion: ${EXECUTE_PROMOTION}"
  echo "- promotion_dry_run: ${PROMOTION_DRY_RUN}"
  echo "- watchdog_window_minutes: ${WATCHDOG_WINDOW_MINUTES}"
  echo "- gate_dir: ${RC_GATE_DIR}"
  echo
  echo "## Phase 1: Tenant Drill"
  echo
} > "$GATE_REPORT"

set +e
DRILL_OUT="$(
  SUPABASE_URL="$SUPABASE_URL" \
  SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  DRILL_MATRIX_JSON="$DRILL_MATRIX_JSON" \
  DRY_RUN="true" \
  EVIDENCE_DIR="$DRILL_OUT_DIR" \
  OPERATOR="$OPERATOR" \
  CHANGE_REQUEST_ID="$CHANGE_REQUEST_ID" \
  bash "${SCRIPT_DIR}/run_tenant_golive_drill.sh" 2>&1
)"
DRILL_RC=$?
set -e

{
  echo '```text'
  echo "$DRILL_OUT"
  echo '```'
  echo
  echo "- evidence_dir: ${DRILL_OUT_DIR}"
} >> "$GATE_REPORT"

if [[ $DRILL_RC -ne 0 ]]; then
  phase_fail "tenant_drill" "$DRILL_RC"
fi

{
  echo
  echo "## Phase 2: Preflight Watchdog"
  echo
} >> "$GATE_REPORT"

set +e
WATCHDOG_PRE_OUT="$(
  SUPABASE_URL="$SUPABASE_URL" \
  SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  TENANT_IDS="$TENANT_IDS" \
  WINDOW_MINUTES="$WATCHDOG_WINDOW_MINUTES" \
  ALERT_ERROR_RATE_PCT="${ALERT_ERROR_RATE_PCT:-5}" \
  ALERT_P95_LATENCY_MS="${ALERT_P95_LATENCY_MS:-2000}" \
  ALERT_PROVIDER_ERRORS="${ALERT_PROVIDER_ERRORS:-1}" \
  ALERT_RATE_LIMITED_REQUESTS="${ALERT_RATE_LIMITED_REQUESTS:-20}" \
  ALERT_MIN_REQUESTS="${ALERT_MIN_REQUESTS:-20}" \
  AUTO_ROLLBACK_ON_ALERT="false" \
  WATCHDOG_SUMMARY_PATH="$WATCHDOG_PREFLIGHT_MD" \
  bash "${SCRIPT_DIR}/run_rollout_watchdog.sh" 2>&1
)"
WATCHDOG_PRE_RC=$?
set -e

{
  echo '```text'
  echo "$WATCHDOG_PRE_OUT"
  echo '```'
  echo
  echo "- watchdog_summary: ${WATCHDOG_PREFLIGHT_MD}"
} >> "$GATE_REPORT"

if [[ $WATCHDOG_PRE_RC -ne 0 ]]; then
  phase_fail "watchdog_preflight" "$WATCHDOG_PRE_RC"
fi

if [[ "$EXECUTE_PROMOTION" == "true" ]]; then
  {
    echo
    echo "## Phase 3: Controlled Promotion"
    echo
  } >> "$GATE_REPORT"

  set +e
  PROMOTE_OUT="$(
    SUPABASE_URL="$SUPABASE_URL" \
    SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    DRILL_MATRIX_JSON="$DRILL_MATRIX_JSON" \
    DRY_RUN="$PROMOTION_DRY_RUN" \
    EVIDENCE_DIR="$PROMOTION_OUT_DIR" \
    OPERATOR="$OPERATOR" \
    CHANGE_REQUEST_ID="$CHANGE_REQUEST_ID" \
    bash "${SCRIPT_DIR}/run_tenant_golive_drill.sh" 2>&1
  )"
  PROMOTE_RC=$?
  set -e

  {
    echo '```text'
    echo "$PROMOTE_OUT"
    echo '```'
    echo
    echo "- promotion_evidence_dir: ${PROMOTION_OUT_DIR}"
  } >> "$GATE_REPORT"

  if [[ $PROMOTE_RC -ne 0 ]]; then
    phase_fail "controlled_promotion" "$PROMOTE_RC"
  fi
else
  {
    echo
    echo "## Phase 3: Controlled Promotion"
    echo
    echo "_Skipped: EXECUTE_PROMOTION=false_"
  } >> "$GATE_REPORT"
fi

{
  echo
  echo "## Phase 4: Postflight Watchdog"
  echo
} >> "$GATE_REPORT"

set +e
WATCHDOG_POST_OUT="$(
  SUPABASE_URL="$SUPABASE_URL" \
  SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  TENANT_IDS="$TENANT_IDS" \
  WINDOW_MINUTES="$WATCHDOG_WINDOW_MINUTES" \
  ALERT_ERROR_RATE_PCT="${ALERT_ERROR_RATE_PCT:-5}" \
  ALERT_P95_LATENCY_MS="${ALERT_P95_LATENCY_MS:-2000}" \
  ALERT_PROVIDER_ERRORS="${ALERT_PROVIDER_ERRORS:-1}" \
  ALERT_RATE_LIMITED_REQUESTS="${ALERT_RATE_LIMITED_REQUESTS:-20}" \
  ALERT_MIN_REQUESTS="${ALERT_MIN_REQUESTS:-20}" \
  AUTO_ROLLBACK_ON_ALERT="false" \
  WATCHDOG_SUMMARY_PATH="$WATCHDOG_POST_MD" \
  bash "${SCRIPT_DIR}/run_rollout_watchdog.sh" 2>&1
)"
WATCHDOG_POST_RC=$?
set -e

{
  echo '```text'
  echo "$WATCHDOG_POST_OUT"
  echo '```'
  echo
  echo "- watchdog_summary: ${WATCHDOG_POST_MD}"
} >> "$GATE_REPORT"

if [[ $WATCHDOG_POST_RC -ne 0 ]]; then
  phase_fail "watchdog_postflight" "$WATCHDOG_POST_RC"
fi

{
  echo
  echo "## Gate Status"
  echo
  echo "- result: PASSED"
  echo "- signoff_ready: true"
} >> "$GATE_REPORT"

echo "RC gate passed. Report: ${GATE_REPORT}"
