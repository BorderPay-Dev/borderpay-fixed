#!/usr/bin/env bash
set -euo pipefail

# Step 2N: scheduled multi-tenant rollout watchdog + optional rollback hook.
#
# Required env:
#   SUPABASE_URL
#   SERVICE_ROLE_KEY
#   TENANT_IDS              comma-separated tenant UUIDs
#
# Optional env:
#   WINDOW_MINUTES                default 15
#   ALERT_ERROR_RATE_PCT          default 5
#   ALERT_P95_LATENCY_MS          default 2000
#   ALERT_PROVIDER_ERRORS         default 1
#   ALERT_RATE_LIMITED_REQUESTS   default 20
#   ALERT_MIN_REQUESTS            default 20
#   AUTO_ROLLBACK_ON_ALERT        true|false (default false)
#   AUTO_ROLLBACK_REVOKE_KEYS     true|false (default true)
#   WATCHDOG_SUMMARY_PATH         default /tmp/api_rollout_watchdog_summary.md

if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "SUPABASE_URL is required" >&2
  exit 1
fi
if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "SERVICE_ROLE_KEY is required" >&2
  exit 1
fi
if [[ -z "${TENANT_IDS:-}" ]]; then
  echo "TENANT_IDS is required (comma-separated UUID list)" >&2
  exit 1
fi

AUTO_ROLLBACK_ON_ALERT="${AUTO_ROLLBACK_ON_ALERT:-false}"
AUTO_ROLLBACK_REVOKE_KEYS="${AUTO_ROLLBACK_REVOKE_KEYS:-true}"
WATCHDOG_SUMMARY_PATH="${WATCHDOG_SUMMARY_PATH:-/tmp/api_rollout_watchdog_summary.md}"

IFS=',' read -r -a TENANT_LIST <<< "${TENANT_IDS}"

alerts=0
ok_count=0
rollback_count=0

{
  echo "# API Rollout Watchdog"
  echo
  echo "- timestamp_utc: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- tenants_total: ${#TENANT_LIST[@]}"
  echo "- auto_rollback_on_alert: ${AUTO_ROLLBACK_ON_ALERT}"
  echo
} > "$WATCHDOG_SUMMARY_PATH"

for raw_tenant in "${TENANT_LIST[@]}"; do
  tenant="$(echo "$raw_tenant" | xargs)"
  if [[ -z "$tenant" ]]; then
    continue
  fi

  echo "== tenant: ${tenant} =="

  set +e
  OUT="$(
    SUPABASE_URL="$SUPABASE_URL" \
    SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    TENANT_ID="$tenant" \
    WINDOW_MINUTES="${WINDOW_MINUTES:-15}" \
    ALERT_ERROR_RATE_PCT="${ALERT_ERROR_RATE_PCT:-5}" \
    ALERT_P95_LATENCY_MS="${ALERT_P95_LATENCY_MS:-2000}" \
    ALERT_PROVIDER_ERRORS="${ALERT_PROVIDER_ERRORS:-1}" \
    ALERT_RATE_LIMITED_REQUESTS="${ALERT_RATE_LIMITED_REQUESTS:-20}" \
    ALERT_MIN_REQUESTS="${ALERT_MIN_REQUESTS:-20}" \
    bash "$(dirname "$0")/monitor_api_rollout.sh" 2>&1
  )"
  RC=$?
  set -e

  {
    echo "## Tenant ${tenant}"
    echo
    echo '```text'
    echo "$OUT"
    echo '```'
    echo
  } >> "$WATCHDOG_SUMMARY_PATH"

  if [[ $RC -eq 0 ]]; then
    ok_count=$((ok_count + 1))
    continue
  fi

  if [[ $RC -eq 10 ]]; then
    alerts=$((alerts + 1))
    if [[ "${AUTO_ROLLBACK_ON_ALERT}" == "true" ]]; then
      RB_OUT="$(
        SUPABASE_URL="$SUPABASE_URL" \
        SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
        TENANT_ID="$tenant" \
        REVOKE_ACTIVE_KEYS="${AUTO_ROLLBACK_REVOKE_KEYS}" \
        bash "$(dirname "$0")/emergency_rollback_tenant.sh" 2>&1 || true
      )"
      rollback_count=$((rollback_count + 1))
      {
        echo "### Auto rollback"
        echo
        echo '```text'
        echo "$RB_OUT"
        echo '```'
        echo
      } >> "$WATCHDOG_SUMMARY_PATH"
    fi
    continue
  fi

  echo "watchdog runtime error for tenant ${tenant}" >&2
  exit $RC
done

{
  echo "## Summary"
  echo
  echo "- ok_tenants: ${ok_count}"
  echo "- alert_tenants: ${alerts}"
  echo "- rollbacks_executed: ${rollback_count}"
} >> "$WATCHDOG_SUMMARY_PATH"

if [[ $alerts -gt 0 ]]; then
  echo "rollout_watchdog: ALERT (${alerts} tenants)"
  exit 10
fi

echo "rollout_watchdog: CLEAR"
