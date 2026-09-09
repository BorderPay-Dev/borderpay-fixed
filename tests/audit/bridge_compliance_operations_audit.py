#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    value = (ROOT / path).read_text(encoding="utf-8")
    if not value.strip():
        raise AssertionError(f"{path} is empty")
    return value


def require(text: str, needles: list[str], source: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    if missing:
        raise AssertionError(f"{source} missing required controls: {missing}")


def ordered(text: str, first: str, second: str, source: str) -> None:
    left = text.find(first)
    right = text.find(second)
    if left < 0 or right < 0 or left >= right:
        raise AssertionError(f"{source}: expected {first!r} before {second!r}")


def main() -> None:
    migration = read("supabase/migrations/20260820160000_bridge_compliance_operations.sql")
    require(migration, [
        "create table if not exists public.bridge_funds_requests",
        "create table if not exists public.bridge_compliance_cases",
        "create table if not exists public.bridge_return_approvals",
        "unique (case_id, actor_id)",
        "create table if not exists public.bridge_return_operations",
        "idempotency_key text not null unique",
        "create table if not exists public.operator_provider_event_notifications",
        "unique (provider, provider_event_id, recipient, channel)",
        "enable row level security",
        "public.is_borderpay_admin()",
    ], "compliance migration")

    backend = read("supabase/functions/admin-compliance/index.ts")
    require(backend, [
        '.select("user_id,email,role")',
        'bridgeGet(`/v0/funds_requests?',
        'bridgePost("/v0/transfers"',
        'BRIDGE_RETURNS_ENABLED',
        'if (!RETURNS_ENABLED)',
        'approvedActors.size < 2',
        'liveFundsRequest(fundsRequest)',
        'Idempotency-Key',
        'assertBridgeFiatReturnPolicy',
        'funds_request_transport: "polling"',
        "COMPLIANCE_WORKER_TOKEN",
        "notice_date_starting_on",
        "authoritativeCustomerFrozen",
        "operator account exclusion lookup failed",
        "operator Bridge accounts are not eligible",
    ], "admin compliance backend")
    require_admin_start = backend.index("async function requireAdmin")
    require_admin_end = backend.index("function timingSafeEqual", require_admin_start)
    require_admin = backend[require_admin_start:require_admin_end]
    if "is_active" in require_admin:
        raise AssertionError("admin compliance backend must use the production admin_users membership contract")
    ordered(require_admin, '.eq("user_id", authData.user.id)', "if (error || !admin || !role)", "admin compliance authorization")
    ordered(backend, "approvedActors.size < 2", "liveFundsRequest(fundsRequest)", "admin compliance backend")
    ordered(backend, "liveFundsRequest(fundsRequest)", 'bridgePost("/v0/transfers"', "admin compliance backend")
    policy = read("supabase/functions/_shared/bridge-fiat-return-policy.ts")
    require(policy, [
        "60 * 24 * 60 * 60 * 1000",
        "ACH/FedNow returns must equal the original deposit amount",
        "Wire/SEPA return amount cannot exceed",
        "authorized only for ACH, FedNow, Wire, and SEPA",
        "TO ORIGINAL SENDER",
        'destinationCurrency !== "usd"',
        "BigInt",
    ], "Bridge fiat return policy")
    require(migration, [
        "public.invoke_bridge_funds_request_poll()",
        "bridge-funds-request-poll",
        "*/5 * * * *",
        "/admin-compliance",
    ], "funds-request polling schedule")

    bridge_worker = read("supabase/functions/process-pending-events/index.ts")
    require(bridge_worker, [
        "operator_provider_event_notifications",
        "admin.provider_transaction_event",
        "operator:bridge:${ev.event_id}:${recipient}",
        "await processEvent(ev);",
        "await emailOperatorTransactionEventBestEffort(ev);",
        'from("bridge_return_operations")',
        'from("bridge_compliance_cases")',
        "shouldNotifyBridgeOperator",
        "bridgeOperatorEventState",
    ], "Bridge webhook worker")
    ordered(bridge_worker, "await processEvent(ev);", "await emailOperatorTransactionEventBestEffort(ev);", "Bridge webhook worker")

    yellowcard = read("supabase/functions/yellowcard-webhook/index.ts")
    require(yellowcard, [
        "verifyYellowCardWebhookSignature",
        "apply_yellowcard_webhook_event",
        "operator_provider_event_notifications",
        "admin.provider_transaction_event",
        "operator:yellow-card:${input.fingerprint}:${recipient}",
        "await emailOperatorYellowCardEventBestEffort",
    ], "Yellow Card webhook receiver")
    jit_transition = yellowcard.index('transition_yellowcard_jit_payout')
    jit_email = yellowcard.index("await emailOperatorYellowCardEventBestEffort", jit_transition)
    if jit_email <= jit_transition:
        raise AssertionError("Yellow Card JIT webhook email must follow its durable state transition")
    projection = yellowcard.index('apply_yellowcard_webhook_event')
    projected_email = yellowcard.index("await emailOperatorYellowCardEventBestEffort", projection)
    if projected_email <= projection:
        raise AssertionError("Yellow Card webhook email must follow its durable projection")

    template = read("supabase/functions/_shared/email-templates/admin/provider-transaction-event.ts")
    require(template, ["Provider event", "Resource", "Customer", "BorderPay user", "Occurred"], "operator email template")

    print("PASS: Bridge compliance operations, controlled returns, provider event notifications, and reconciliation controls")


if __name__ == "__main__":
    main()
