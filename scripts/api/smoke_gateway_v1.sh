#!/usr/bin/env bash
set -euo pipefail

# Smoke test for BorderPay API gateway v1 (Step 2C)
# Required env:
#   GATEWAY_URL   e.g. https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/public-api-gateway
#   API_KEY       issued via api-gateway-admin create_api_key
# Optional:
#   MODE          sandbox|production (default sandbox)

if [[ -z "${GATEWAY_URL:-}" ]]; then
  echo "GATEWAY_URL is required" >&2
  exit 1
fi
if [[ -z "${API_KEY:-}" ]]; then
  echo "API_KEY is required" >&2
  exit 1
fi

MODE="${MODE:-sandbox}"

call() {
  local method="$1"
  local route="$2"
  local idem="$3"
  local payload="$4"

  echo "\n=== ${method} ${route} ==="
  curl -sS "$GATEWAY_URL" \
    -X POST \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-borderpay-route: ${route}" \
    -H "x-borderpay-mode: ${MODE}" \
    -H "Idempotency-Key: ${idem}" \
    -d "${payload}" | sed 's/{/\n{/g'
  echo
}

echo "\n=== GET /v1/health ==="
curl -sS "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/health" \
  -H "x-borderpay-mode: ${MODE}" \
  -d '{"method":"GET"}' | sed 's/{/\n{/g'

echo

echo "Run the mutable route tests only with valid test data and Bridge sandbox credentials."
echo "Example templates below (edit values first):"

echo "\n# 1) Create customer"
call "POST" "/v1/customers" "idem-customer-001" '{"account_type":"individual","email":"api-test@example.com","country_code":"NG","full_name":"API Test User","borderpay_user_id":"00000000-0000-0000-0000-000000000000"}'

echo "\n# 2) Create wallet (requires real customer_id)"
call "POST" "/v1/wallets" "idem-wallet-001" '{"customer_id":"replace_customer_id","symbol":"USDC","chain":"BASE"}'

echo "\n# 3) Create webhook endpoint"
call "POST" "/v1/webhooks" "idem-webhook-001" '{"endpoint_url":"https://example.com/webhook"}'

echo "\n# 4) Idempotency replay check (same key + same payload should replay)"
call "POST" "/v1/webhooks" "idem-webhook-replay-001" '{"endpoint_url":"https://example.com/replay"}'
call "POST" "/v1/webhooks" "idem-webhook-replay-001" '{"endpoint_url":"https://example.com/replay"}'

echo "\n# 5) Idempotency mismatch check (same key + different payload should 409)"
call "POST" "/v1/webhooks" "idem-webhook-mismatch-001" '{"endpoint_url":"https://example.com/mismatch-a"}'
call "POST" "/v1/webhooks" "idem-webhook-mismatch-001" '{"endpoint_url":"https://example.com/mismatch-b"}'
