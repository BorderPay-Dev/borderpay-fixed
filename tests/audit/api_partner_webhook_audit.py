#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
checks = []

def require(path: str, *tokens: str) -> None:
    text = (ROOT / path).read_text()
    for token in tokens:
        checks.append((f"{path}: {token}", token in text))

require("supabase/migrations/20260817100000_api_partner_webhook_delivery.sql",
        "delivery_enabled boolean not null default false",
        "api_webhook_events_tenant_idempotency_unique",
        "for update of d skip locked",
        "attempt_count = d.attempt_count + 1",
        "v_attempts >= 10",
        "api-partner-webhook-drain",
        "api_webhook_worker_token",
        "trg_api_webhook_enqueue_completed_provider_event",
        "new.status <> 'completed'",
        "revoke all on function public.api_webhook_enqueue_event")
require("supabase/migrations/20260817101000_api_webhook_worker_secret_lockdown.sql",
        "api_private.api_webhook_runtime_secrets",
        "delete from public.app_config where key = 'api_webhook_worker_token'",
        "revoke all on schema api_private from anon, authenticated",
        "from api_private.api_webhook_runtime_secrets")
require("supabase/functions/_shared/api-webhook-security.ts",
        "API_WEBHOOK_ENCRYPTION_KEY",
        "AES-GCM",
        "additionalData: asArrayBuffer(secretAad",
        "Webhook endpoint must use HTTPS",
        "`${timestamp}.${body}`")
require("supabase/functions/api-webhook-worker/index.ts",
        "API_WEBHOOK_WORKER_TOKEN",
        "timingSafeEqual",
        'redirect: "manual"',
        "AbortSignal.timeout(10_000)",
        '"X-BorderPay-Signature"',
        '"X-BorderPay-Timestamp"')
require("supabase/functions/public-api-gateway/index.ts",
        "encryptApiWebhookSecret(",
        "signing_secret_ciphertext: encrypted.ciphertext",
        "delivery_enabled: true",
        "enqueueApiResourceEvent")

worker = (ROOT / "supabase/functions/api-webhook-worker/index.ts").read_text()
checks.extend([
    ("redirects are blocked before delivery completion", worker.index('redirect: "manual"') < worker.index("await finish(item.delivery_id, true")),
])

failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(("PASS" if ok else "FAIL") + ": " + name)
if failed:
    raise SystemExit(1)
print(f"PASS: API partner webhook audit ({len(checks)}/{len(checks)})")
