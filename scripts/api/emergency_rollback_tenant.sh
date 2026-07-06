#!/usr/bin/env bash
set -euo pipefail

# Step 2M: emergency rollback hook for API tenant.
#
# Required env:
#   SUPABASE_URL
#   SERVICE_ROLE_KEY
#   TENANT_ID
#
# Optional env:
#   REVOKE_ACTIVE_KEYS      true|false (default true)
#   GATEWAY_API_KEY         optional key used to assert post-rollback block

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

REVOKE_ACTIVE_KEYS="${REVOKE_ACTIVE_KEYS:-true}"
ADMIN_FN="${SUPABASE_URL%/}/functions/v1/api-gateway-admin"
PUBLIC_GATEWAY_FN="${SUPABASE_URL%/}/functions/v1/public-api-gateway"

ROLLBACK_RESP="$(curl -sS "$ADMIN_FN" \
  -X POST \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"emergency_rollback_tenant\",\"tenant_id\":\"${TENANT_ID}\",\"revoke_active_keys\":${REVOKE_ACTIVE_KEYS}}")"

echo "$ROLLBACK_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("rollback failed:", obj)
    raise SystemExit(2)
d = obj.get("data") or {}
print("rollback: APPLIED")
print(json.dumps(d, sort_keys=True))
PY

if [[ -n "${GATEWAY_API_KEY:-}" ]]; then
  CHECK_RESP="$(curl -sS "$PUBLIC_GATEWAY_FN" \
    -X POST \
    -H "Authorization: Bearer ${GATEWAY_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-borderpay-route: /v1/health" \
    -H "x-borderpay-mode: production" \
    -d '{"method":"GET"}')"
  echo "$CHECK_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
err = obj.get("error") or {}
code = str(err.get("code") or "")
if code not in ("forbidden", "unauthorized"):
    print("rollback verification failed:", obj)
    raise SystemExit(3)
print("rollback verification: PASS")
PY
fi

