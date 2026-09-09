# BorderPay API v1 Curl Cookbook (Step 2F)

Source of truth: `docs/api/openapi-v1.yaml` (v1.0.1)

## 0) Environment
```bash
export GATEWAY_URL="https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/public-api-gateway"
export ADMIN_URL="https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/api-gateway-admin"
export API_KEY="<issued_plain_api_key>"
export ADMIN_JWT="<admin_jwt_or_service_role>"
export MODE="sandbox"
export SOURCE_WALLET_ID="<owned_bridge_wallet_id>"
export DESTINATION_WALLET_ID="<owned_destination_bridge_wallet_id>"
export EXTERNAL_ACCOUNT_ID="<owned_bridge_external_account_id>"
```

## 1) Gateway health
```bash
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/health" \
  -H "x-borderpay-mode: $MODE" \
  -d '{"method":"GET"}'
```

## 2) Create customer
```bash
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/customers" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-customer-001" \
  -d '{
    "account_type":"individual",
    "email":"partner-user@example.com",
    "country_code":"NG",
    "full_name":"Partner User",
    "borderpay_user_id":"partner_ref_001"
  }'
```

## 3) Create wallet
```bash
export CUSTOMER_ID="<customer_id_from_previous_response>"

curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/wallets" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-wallet-001" \
  -d "{
    \"customer_id\":\"$CUSTOMER_ID\",
    \"symbol\":\"USDC\",
    \"chain\":\"BASE\"
  }"
```

## 4) Create virtual account
```bash
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/virtual-accounts" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-va-001" \
  -d "{
    \"customer_id\":\"$CUSTOMER_ID\",
    \"currency\":\"USD\",
    \"destination\":{
      \"payment_rail\":\"base\",
      \"currency\":\"USDC\",
      \"bridge_wallet_id\":\"$SOURCE_WALLET_ID\"
    }
  }"
```

## 5) Create transfer
```bash
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/transfers" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-transfer-001" \
  -d "{
    \"source\":{
      \"payment_rail\":\"bridge_wallet\",
      \"currency\":\"USDC\",
      \"amount\":\"10.00\",
      \"bridge_wallet_id\":\"$SOURCE_WALLET_ID\"
    },
    \"destination\":{
      \"payment_rail\":\"bridge_wallet\",
      \"currency\":\"USDC\",
      \"bridge_wallet_id\":\"$DESTINATION_WALLET_ID\"
    },
    \"idempotency_key\":\"idem-transfer-001\"
  }"
```

## 6) Create payout
```bash
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/payouts" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-payout-001" \
  -d "{
    \"source\":{
      \"payment_rail\":\"bridge_wallet\",
      \"currency\":\"USDT\",
      \"amount\":\"15.00\",
      \"bridge_wallet_id\":\"$SOURCE_WALLET_ID\"
    },
    \"destination\":{
      \"payment_rail\":\"ach\",
      \"currency\":\"USD\",
      \"external_account_id\":\"$EXTERNAL_ACCOUNT_ID\"
    },
    \"idempotency_key\":\"idem-payout-001\"
  }"
```

## 7) Register webhook endpoint
```bash
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/webhooks" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-webhook-001" \
  -d '{"endpoint_url":"https://example.com/borderpay/webhooks"}'
```

The response returns the signing secret once. BorderPay signs the exact raw
request body using HMAC-SHA256 over `<unix_timestamp>.<raw_body>` and sends
`X-BorderPay-Delivery-Id`, `X-BorderPay-Event-Id`,
`X-BorderPay-Timestamp`, and `X-BorderPay-Signature: v1=<hex>`.

Return any `2xx` response within 10 seconds. Timeouts, `408`, `429`, and `5xx`
are retried with bounded exponential backoff; other `4xx` responses are terminal.

## 8) Admin: create tenant
```bash
curl -s "$ADMIN_URL" \
  -X POST \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "action":"upsert_tenant",
    "tenant_name":"Partner Sandbox A",
    "default_mode":"sandbox",
    "rate_limit_per_minute":120
  }'
```

## 9) Admin: issue API key
```bash
export TENANT_ID="<tenant_id_from_previous_response>"

curl -s "$ADMIN_URL" \
  -X POST \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\":\"create_api_key\",
    \"tenant_id\":\"$TENANT_ID\",
    \"key_label\":\"partner-primary\",
    \"scopes\":[
      \"customers:write\",
      \"wallets:write\",
      \"virtual_accounts:write\",
      \"transfers:write\",
      \"payouts:write\",
      \"webhooks:write\"
    ]
  }"
```

## 10) Idempotency replay check
```bash
# First call
curl -is "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/webhooks" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-replay-001" \
  -d '{"endpoint_url":"https://example.com/replay"}'

# Replay call (same body + same key) should return X-Idempotent-Replay: true
curl -is "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/webhooks" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-replay-001" \
  -d '{"endpoint_url":"https://example.com/replay"}'
```

## 11) Idempotency mismatch check
```bash
# First
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/webhooks" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-mismatch-001" \
  -d '{"endpoint_url":"https://example.com/a"}'

# Second with different body should fail 409 idempotency_replay_mismatch
curl -s "$GATEWAY_URL" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-borderpay-route: /v1/webhooks" \
  -H "x-borderpay-mode: $MODE" \
  -H "Idempotency-Key: idem-mismatch-001" \
  -d '{"endpoint_url":"https://example.com/b"}'
```
