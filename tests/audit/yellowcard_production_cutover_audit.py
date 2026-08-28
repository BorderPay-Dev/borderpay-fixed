#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


client = read("supabase/functions/_shared/providers/yellowcard-client.ts")
relay = read("ops/yellowcard-relay/server.mjs")
transaction = read("supabase/functions/yellowcard-transaction/index.ts")
capabilities = read("supabase/functions/yellowcard-capabilities/index.ts")
webhook = read("supabase/functions/yellowcard-webhook/index.ts")
corridor_sync = read("supabase/functions/yellowcard-corridor-sync/index.ts")
config = read("supabase/config.toml")
send = read("components/send/SendMoneyFlow.tsx")
receive = read("components/receive/ReceiveMoneyScreen.tsx")
api = read("utils/api/backendAPI.ts")
migration = read("supabase/migrations/20260825120000_yellowcard_production_runtime.sql")
workflow = read(".github/workflows/yellowcard-suite.yml")

# This gate deliberately constructs forbidden names in pieces so a repository
# scan can distinguish the guard itself from an actual legacy integration.
forbidden_tokens = (
    "YC_" + "SANDBOX",
    "YELLOW_CARD_" + "SANDBOX",
    "api.yellowcard.io/" + "sandbox",
    "yellowcard-" + "sandbox",
)
forbidden_paths = (
    ROOT / "supabase/functions" / ("yellowcard-" + "sandbox-transaction"),
    ROOT / "supabase/functions" / ("yellowcard-" + "sandbox-diagnostics"),
    ROOT / "supabase/functions/_shared/providers" / ("yellowcard-" + "sandbox-scope.ts"),
)
for path in forbidden_paths:
    require(not path.exists(), f"legacy Yellow Card runtime must not exist: {path.relative_to(ROOT)}")

scan_roots = (
    ROOT / "supabase/functions",
    ROOT / "components",
    ROOT / "utils",
    ROOT / ".github/workflows",
)
for scan_root in scan_roots:
    for path in scan_root.rglob("*"):
        if not path.is_file() or path == Path(__file__).resolve():
            continue
        source = path.read_text(encoding="utf-8", errors="ignore")
        for forbidden in forbidden_tokens:
            require(forbidden.lower() not in source.lower(),
                    f"legacy Yellow Card sandbox reference remains: {path.relative_to(ROOT)}")

require('const PRODUCTION_BASE_URL = "https://api.yellowcard.io/business"' in client,
        "Yellow Card production host must be pinned")
require("YC_PRODUCTION_API_KEY" in client and "YC_PRODUCTION_SECRET_KEY" in client,
        "dedicated production credentials are required")
require('REQUIRED_RELAY_URL = "https://static-ip.borderpayafrica.com/yellowcard/v1/request"' in client,
        "production calls must use the static-egress relay")
require('YC_EGRESS_RELAY_TOKEN.length >= 32' in client,
        "relay authentication must fail closed")
require("path: relayPath(opts.path)" in client,
        "relay must receive provider-relative routes, not /business-prefixed signed paths")
require("path: url.pathname" not in client,
        "signed /business pathname must never be forwarded as the restricted relay route")
for forbidden in forbidden_tokens[:3]:
    require(forbidden not in client, f"production client contains sandbox fallback: {forbidden}")

require('const YELLOW_CARD_BASE = "https://api.yellowcard.io/business"' in relay,
        "relay upstream must be pinned to Yellow Card production")
require('method === "POST" && path === "/receive"' in relay,
        "relay must permit production Receive")
require('path === "/send") return SEND_ENABLED' in relay and
        'process.env.YC_SEND_ENABLED' in relay,
        "relay must keep production Send behind an independent fail-closed switch")
require("route_forbidden" in relay and "timingSafeEqual" in relay,
        "relay must enforce route and token boundaries")

require('flag("YC_PRODUCTION_ENABLED")' in transaction,
        "transaction execution must require the production feature flag")
require('flag("YC_PRODUCTION_RECEIVE_ENABLED")' in transaction,
        "production Receive must require its own feature flag")
require('source: "yellow_card_production_api"' in capabilities and
        'discovery_status: "live"' in capabilities,
        "corridor availability must come from the live Yellow Card API")
require('pricing_source: "yellow_card_commercial_team_document_2026"' in capabilities,
        "the signed commercial schedule must remain the pricing boundary")
require('const publicRows = availability.filter(({ available }) => available)' in capabilities,
        "inactive live corridors must not be exposed to customers")
require('.eq("environment", "production")' in transaction and 'environment: "production"' in transaction,
        "transaction reads and writes must be production-scoped")
require('.from("bridge_wallets")' in transaction and 'code: "settlement_wallet_required"' in transaction,
        "receive must use an actual active customer settlement wallet")
require('direction === "receive" && profileCountry !== country' in transaction and
        "allow_all_receive_countries" not in transaction,
        "receive country must come from the authoritative profile and must not be client-bypassable")
require('!flag("YC_PRODUCTION_SEND_ENABLED")' in transaction and
        'code: "yellow_card_payout_locked"' in transaction,
        "production Send must remain fail-closed until controlled activation")
require('source_account_number: collectionSourceAccount.trim() || undefined' in receive,
        "Receive must submit the real source account/mobile number")
require('channelType: yellowCardPayloadAccountType(context.channel)' in transaction and
        'channelId: str(context.selectedChannel?.id)' not in transaction.split('}) : buildYellowCardReceivePayload({', 1)[1],
        "production Receive must use Yellow Card channelType auto-routing")
require('customer_wallet_funding_orchestration_unavailable' in transaction,
        "production Send must fail closed until customer-wallet funding orchestration exists")
require('if (isSend) {' in transaction and 'yellow_card_customer_funding_orchestration_unavailable' in transaction,
        "production Send must not be unlocked by a feature flag alone")
require("yellowCardTransaction" in receive and "yellowcard-transaction" in api,
        "customer Receive must call the production transaction endpoint")
require("yellowCardJitPayout({ action: 'readiness' })" in send and
        "result?.data?.execution_enabled === true" in send,
        "customer Send must follow authenticated server-side JIT readiness")
require('code: "yellow_card_jit_payout_disabled"' in
        (ROOT / "supabase/functions/yellowcard-jit-payout/index.ts").read_text(),
        "JIT payout execution must fail closed when rollout flags are disabled")

require('req.headers.get("X-YC-Signature")' in webhook and
        "verifyYellowCardWebhookSignature" in webhook,
        "webhook must verify the raw-body HMAC signature")
require('p_environment: "production"' in webhook and "api_key_mismatch" in webhook,
        "webhook must be bound to the configured production account")
require("yellowcard_webhook_events_immutable" in migration and
        "apply_yellowcard_webhook_event" in migration,
        "signed callbacks need immutable evidence and atomic projection")
require("default 'production'" in migration,
        "new Yellow Card transaction rows must default to production")

require("[functions.yellowcard-transaction]" in config, "production transaction function is not configured")
require("[functions.yellowcard-webhook]" in config, "production webhook function is not configured")
require("[functions.yellowcard-corridor-sync]" in config, "production discovery function is not configured")
for forbidden in ("[functions.yellowcard-sandbox-transaction]", "[functions.yellowcard-sandbox-diagnostics]"):
    require(forbidden not in config, f"sandbox runtime remains configured: {forbidden}")

runtime_paths = [
    "components/send/SendMoneyFlow.tsx",
    "components/receive/ReceiveMoneyScreen.tsx",
    "utils/api/backendAPI.ts",
    "supabase/functions/yellowcard-transaction/index.ts",
    "supabase/functions/yellowcard-capabilities/index.ts",
    "supabase/functions/_shared/providers/yellowcard-client.ts",
]
for path in runtime_paths:
    source = read(path).lower()
    require("sandbox" not in source, f"sandbox behavior remains in active runtime: {path}")

for legacy_secret in (
    "YC_" + "ENABLED",
    "YC_" + "ENVIRONMENT",
    "YC_LIVE_" + "ROUTING_ENABLED",
    "YC_MONEY_" + "MOVEMENT_ENABLED",
    "YELLOW_CARD_" + "BASE_URL",
):
    require(legacy_secret not in client and legacy_secret not in transaction and legacy_secret not in capabilities,
            f"legacy Yellow Card configuration is still consumed: {legacy_secret}")

require('config.environment !== "production"' in corridor_sync and
        'body?.dry_run === false || body?.enable_rows === true' in corridor_sync,
        "corridor discovery must be production-only and read-only")

require("python3 tests/audit/yellowcard_production_cutover_audit.py" in workflow,
        "Yellow Card production-only regression audit must run in CI")
for trigger in (
    '"supabase/config.toml"',
    '"supabase/migrations/*yellowcard*"',
    '"ops/yellowcard-relay/**"',
):
    require(trigger in workflow, f"CI production gate is missing change trigger: {trigger}")

print("yellowcard production cutover audit: PASS")
