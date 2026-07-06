#!/usr/bin/env bash
set -euo pipefail

# Step 2L: deterministic partner onboarding preflight.
#
# Required env:
#   SUPABASE_URL
#   SERVICE_ROLE_KEY
#   API_KEY
#
# Optional:
#   EXPECT_PROD_FORBIDDEN=true|false (default true)

if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "SUPABASE_URL is required" >&2
  exit 1
fi
if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "SERVICE_ROLE_KEY is required" >&2
  exit 1
fi
if [[ -z "${API_KEY:-}" ]]; then
  echo "API_KEY is required" >&2
  exit 1
fi

EXPECT_PROD_FORBIDDEN="${EXPECT_PROD_FORBIDDEN:-true}"
ADMIN_FN="${SUPABASE_URL%/}/functions/v1/api-gateway-admin"
PUBLIC_GATEWAY_FN="${SUPABASE_URL%/}/functions/v1/public-api-gateway"

probe_health() {
  local mode="$1"
  curl -sS "$PUBLIC_GATEWAY_FN" \
    -X POST \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-borderpay-route: /v1/health" \
    -H "x-borderpay-mode: ${mode}" \
    -d '{"method":"GET"}'
}

echo "=== preflight: admin function auth ==="
ADMIN_RESP="$(curl -sS "$ADMIN_FN" \
  -X POST \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"action":"list_tenants"}')"

echo "$ADMIN_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("admin preflight failed:", obj)
    raise SystemExit(1)
print("admin preflight: PASS")
PY

echo "=== preflight: sandbox health ==="
SBX_RESP="$(probe_health sandbox)"
echo "$SBX_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("sandbox health failed:", obj)
    raise SystemExit(1)
print("sandbox health: PASS")
PY

echo "=== preflight: production health ==="
PROD_RESP="$(probe_health production)"
if [[ "${EXPECT_PROD_FORBIDDEN}" == "true" ]]; then
  echo "$PROD_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
err = obj.get("error") or {}
if str(err.get("code")) != "forbidden":
    print("expected forbidden production preflight, got:", obj)
    raise SystemExit(1)
print("production preflight blocked: PASS")
PY
else
  echo "$PROD_RESP" | python3 - <<'PY'
import json, sys
obj = json.load(sys.stdin)
if not obj.get("success"):
    print("expected production success, got:", obj)
    raise SystemExit(1)
print("production preflight success: PASS")
PY
fi

echo "partner_onboarding_preflight: PASS"
