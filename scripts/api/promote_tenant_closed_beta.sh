#!/usr/bin/env bash
set -euo pipefail

# Step 2K: Closed-beta tenant promotion helper.
#
# Required env:
#   SUPABASE_URL              e.g. https://orwrcpwsffjlvzuraxjc.supabase.co
#   SERVICE_ROLE_KEY          service role key (Bearer for api-gateway-admin)
#   TENANT_ID                 api_tenants.id to update
#   TENANT_NAME               tenant_name required by upsert_tenant action
#
# Optional env:
#   DEFAULT_MODE              sandbox|production (default production)
#   RATE_LIMIT_PER_MINUTE     integer (default 120)
#   MAX_SINGLE_TRANSFER_USD   numeric (default 5000)
#   BETA_ACCESS_ENABLED       true|false (default true)
#   GATEWAY_API_KEY           business API key for health probes
#   PREFLIGHT_EXPECT_FORBIDDEN true|false (default true)

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
if [[ -z "${TENANT_NAME:-}" ]]; then
  echo "TENANT_NAME is required" >&2
  exit 1
fi

DEFAULT_MODE="${DEFAULT_MODE:-production}"
RATE_LIMIT_PER_MINUTE="${RATE_LIMIT_PER_MINUTE:-120}"
MAX_SINGLE_TRANSFER_USD="${MAX_SINGLE_TRANSFER_USD:-5000}"
BETA_ACCESS_ENABLED="${BETA_ACCESS_ENABLED:-true}"
PREFLIGHT_EXPECT_FORBIDDEN="${PREFLIGHT_EXPECT_FORBIDDEN:-true}"

ADMIN_FN="${SUPABASE_URL%/}/functions/v1/api-gateway-admin"
PUBLIC_GATEWAY_FN="${SUPABASE_URL%/}/functions/v1/public-api-gateway"

require_cmd() {
  local c="$1"
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "Missing dependency: $c" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd python3

json_value() {
  local key="$1"
  python3 - "$key" <<'PY'
import json, sys
key = sys.argv[1]
obj = json.load(sys.stdin)
cur = obj
for part in key.split("."):
    if isinstance(cur, dict):
        cur = cur.get(part)
    else:
        cur = None
        break
print("" if cur is None else cur)
PY
}

post_admin() {
  local payload="$1"
  curl -sS "$ADMIN_FN" \
    -X POST \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

gateway_health() {
  local api_key="$1"
  curl -sS "$PUBLIC_GATEWAY_FN" \
    -X POST \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -H "x-borderpay-route: /v1/health" \
    -H "x-borderpay-mode: production" \
    -d '{"method":"GET"}'
}

echo "=== Step 1: preflight tenant snapshot ==="
PRE_LIST="$(post_admin '{"action":"list_tenants"}')"
echo "$PRE_LIST" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("list_tenants failed:", obj)
    raise SystemExit(1)
print("list_tenants: OK")
PY

if [[ -n "${GATEWAY_API_KEY:-}" && "${PREFLIGHT_EXPECT_FORBIDDEN}" == "true" ]]; then
  echo "=== Step 2: preflight gateway probe (expect forbidden before promotion) ==="
  PREFLIGHT_RESP="$(gateway_health "$GATEWAY_API_KEY")"
  echo "$PREFLIGHT_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
err = (obj.get("error") or {})
code = str(err.get("code") or "")
if code != "forbidden":
    print("Expected forbidden preflight, got:", obj)
    raise SystemExit(1)
print("preflight: blocked as expected")
PY
fi

echo "=== Step 3: promote tenant with closed-beta controls ==="
UPSERT_PAYLOAD="$(cat <<JSON
{
  "action":"upsert_tenant",
  "tenant_id":"${TENANT_ID}",
  "tenant_name":"${TENANT_NAME}",
  "default_mode":"${DEFAULT_MODE}",
  "beta_access_enabled":${BETA_ACCESS_ENABLED},
  "max_single_transfer_usd":${MAX_SINGLE_TRANSFER_USD},
  "rate_limit_per_minute":${RATE_LIMIT_PER_MINUTE},
  "is_active":true
}
JSON
)"
UPSERT_RESP="$(post_admin "$UPSERT_PAYLOAD")"
echo "$UPSERT_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("upsert_tenant failed:", obj)
    raise SystemExit(1)
d = obj.get("data") or {}
print("upsert_tenant: OK")
print("tenant_id:", d.get("id"))
print("default_mode:", d.get("default_mode"))
print("beta_access_enabled:", d.get("beta_access_enabled"))
print("max_single_transfer_usd:", d.get("max_single_transfer_usd"))
print("rate_limit_per_minute:", d.get("rate_limit_per_minute"))
PY

if [[ -n "${GATEWAY_API_KEY:-}" ]]; then
  echo "=== Step 4: postflight gateway probe (expect success) ==="
  POST_RESP="$(gateway_health "$GATEWAY_API_KEY")"
  echo "$POST_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("postflight health failed:", obj)
    raise SystemExit(1)
data = obj.get("data") or {}
if str(data.get("mode")) != "production":
    print("postflight mode mismatch:", obj)
    raise SystemExit(1)
print("postflight: production health OK")
PY
fi

echo "=== Closed-beta tenant promotion complete ==="
