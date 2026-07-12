#!/usr/bin/env bash
set -euo pipefail

# Step 2M: production rollout telemetry + alert evaluation.
#
# Required env:
#   SUPABASE_URL
#   SERVICE_ROLE_KEY
#   TENANT_ID
#
# Optional env:
#   WINDOW_MINUTES                default 15
#   ALERT_ERROR_RATE_PCT          default 5
#   ALERT_P95_LATENCY_MS          default 2000
#   ALERT_PROVIDER_ERRORS         default 1
#   ALERT_RATE_LIMITED_REQUESTS   default 20
#   ALERT_MIN_REQUESTS            default 20

if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "SUPABASE_URL is required" >&2
  exit 1
fi
if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "SERVICE_ROLE_KEY is required" >&2
  exit 1
fi
if [[ -z "${TENANT_ID:-}" ]]; then
  echo "TENANT_ID is required" >&2
  exit 1
fi

WINDOW_MINUTES="${WINDOW_MINUTES:-15}"
ALERT_ERROR_RATE_PCT="${ALERT_ERROR_RATE_PCT:-5}"
ALERT_P95_LATENCY_MS="${ALERT_P95_LATENCY_MS:-2000}"
ALERT_PROVIDER_ERRORS="${ALERT_PROVIDER_ERRORS:-1}"
ALERT_RATE_LIMITED_REQUESTS="${ALERT_RATE_LIMITED_REQUESTS:-20}"
ALERT_MIN_REQUESTS="${ALERT_MIN_REQUESTS:-20}"

ADMIN_FN="${SUPABASE_URL%/}/functions/v1/api-gateway-admin"

RESP="$(curl -sS "$ADMIN_FN" \
  -X POST \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"get_rollout_metrics\",\"tenant_id\":\"${TENANT_ID}\",\"window_minutes\":${WINDOW_MINUTES}}")"

RESP_JSON="$RESP" python3 - \
  "$ALERT_ERROR_RATE_PCT" \
  "$ALERT_P95_LATENCY_MS" \
  "$ALERT_PROVIDER_ERRORS" \
  "$ALERT_RATE_LIMITED_REQUESTS" \
  "$ALERT_MIN_REQUESTS" <<'PY'
import json, os, sys

try:
    obj = json.loads(os.environ.get("RESP_JSON") or "{}")
except json.JSONDecodeError as exc:
    print("rollout_metrics: invalid JSON response", str(exc))
    raise SystemExit(2)
if not obj.get("success"):
    print("rollout_metrics: FAIL", obj)
    raise SystemExit(2)

m = obj.get("data") or {}
total = int(m.get("total_requests") or 0)
error_rate = float(m.get("error_rate_pct") or 0.0)
p95 = int(m.get("p95_latency_ms") or 0)
provider_errors = int(m.get("provider_error_requests") or 0)
rate_limited = int(m.get("rate_limited_requests") or 0)

err_threshold = float(sys.argv[1])
p95_threshold = int(float(sys.argv[2]))
provider_threshold = int(float(sys.argv[3]))
rate_limit_threshold = int(float(sys.argv[4]))
min_requests = int(float(sys.argv[5]))

alerts = []
if total >= min_requests:
    if error_rate >= err_threshold:
        alerts.append(f"error_rate_pct={error_rate} >= {err_threshold}")
    if p95 >= p95_threshold:
        alerts.append(f"p95_latency_ms={p95} >= {p95_threshold}")
    if provider_errors >= provider_threshold:
        alerts.append(f"provider_error_requests={provider_errors} >= {provider_threshold}")
    if rate_limited >= rate_limit_threshold:
        alerts.append(f"rate_limited_requests={rate_limited} >= {rate_limit_threshold}")

print("rollout_metrics:", json.dumps(m, sort_keys=True))

if alerts:
    print("rollout_alert: TRIGGERED")
    for a in alerts:
        print(" -", a)
    raise SystemExit(10)

print("rollout_alert: CLEAR")
PY
