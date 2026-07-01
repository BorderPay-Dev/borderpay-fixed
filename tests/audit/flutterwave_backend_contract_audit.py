#!/usr/bin/env python3
"""
Flutterwave backend contract audit (static repository-level checks).

Goal:
- Ensure Step-1 backend runtime artifacts exist in source control before deploy.
"""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

REQUIRED_FILES = [
    "supabase/functions/flutterwave-transfer-create/index.ts",
    "supabase/functions/flutterwave-transfer-status/index.ts",
    "supabase/functions/flutterwave-transfers-list/index.ts",
    "supabase/functions/flutterwave-collection-create/index.ts",
    "supabase/functions/flutterwave-collection-status/index.ts",
    "supabase/functions/flutterwave-collections-list/index.ts",
    "supabase/functions/flutterwave-webhook/index.ts",
    "supabase/functions/_shared/providers/flutterwave.ts",
    "supabase/migrations/20260630190000_flutterwave_transfer_runtime_tables.sql",
]


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def main() -> int:
    failed = False
    for rel in REQUIRED_FILES:
        p = ROOT / rel
        if not p.exists():
            fail(f"Missing required file: {rel}")
            failed = True
        else:
            ok(f"Present: {rel}")

    sql = (ROOT / "supabase/migrations/20260630190000_flutterwave_transfer_runtime_tables.sql").read_text(encoding="utf-8")
    for token in [
        "create table if not exists public.flutterwave_transfers",
        "create table if not exists public.flutterwave_webhook_events",
        "alter table public.flutterwave_transfers enable row level security",
        "alter table public.flutterwave_webhook_events enable row level security",
    ]:
        if token not in sql:
            fail(f"Migration missing token: {token}")
            failed = True
        else:
            ok(f"Migration token found: {token}")

    create_fn = (ROOT / "supabase/functions/flutterwave-transfer-create/index.ts").read_text(encoding="utf-8")
    status_fn = (ROOT / "supabase/functions/flutterwave-transfer-status/index.ts").read_text(encoding="utf-8")
    list_fn = (ROOT / "supabase/functions/flutterwave-transfers-list/index.ts").read_text(encoding="utf-8")
    collection_create_fn = (ROOT / "supabase/functions/flutterwave-collection-create/index.ts").read_text(encoding="utf-8")
    collection_status_fn = (ROOT / "supabase/functions/flutterwave-collection-status/index.ts").read_text(encoding="utf-8")
    collections_list_fn = (ROOT / "supabase/functions/flutterwave-collections-list/index.ts").read_text(encoding="utf-8")
    webhook_fn = (ROOT / "supabase/functions/flutterwave-webhook/index.ts").read_text(encoding="utf-8")
    for label, content, token in [
        ("transfer-create", create_fn, "flutterwaveCreateTransfer"),
        ("transfer-create", create_fn, "flutterwaveRetryTransfer"),
        ("transfer-create", create_fn, 'provider: "flutterwave"'),
        ("transfer-create", create_fn, 'create_scope: "transfer_create"'),
        ("transfer-create", create_fn, 'create_scope: "transfer_retry"'),
        ("transfer-create", create_fn, 'endpoint: "flutterwave-transfer-create"'),
        ("transfer-create", create_fn, "response_contract_version: 1"),
        ("transfer-create", create_fn, "contract_generated_at: new Date().toISOString()"),
        ("transfer-create", create_fn, 'direction: "payout"'),
        ("transfer-create", create_fn, 'source: "flutterwave"'),
        ("transfer-status", status_fn, "flutterwaveGetTransfer"),
        ("transfer-status", status_fn, "ALLOWED_DIRECTION"),
        ("transfer-status", status_fn, "direction must be payout or receive"),
        ("transfer-status", status_fn, '.eq("source", "flutterwave")'),
        ("transfer-status", status_fn, 'endpoint: "flutterwave-transfer-status"'),
        ("transfer-status", status_fn, 'status_scope: "transfer"'),
        ("transfer-status", status_fn, "response_contract_version: 1"),
        ("transfer-status", status_fn, "contract_generated_at: new Date().toISOString()"),
        ("transfer-status", status_fn, 'provider: "flutterwave"'),
        ("transfer-status", status_fn, "source_locked_to_flutterwave: true"),
        ("transfer-status", status_fn, "channel: localRecord.channel || null"),
        ("transfer-status", status_fn, "provider_status: providerStatus"),
        ("transfer-status", status_fn, 'status_source: providerStatus ? "provider" : "local"'),
        ("transfers-list", list_fn, '.eq("user_id", authData.user.id)'),
        ("transfers-list", list_fn, "ALLOWED_DIRECTION"),
        ("transfers-list", list_fn, "ALLOWED_STATUS"),
        ("transfers-list", list_fn, "ALLOWED_CHANNEL"),
        ("transfers-list", list_fn, 'endpoint: "flutterwave-transfers-list"'),
        ("transfers-list", list_fn, 'list_scope: "transfers"'),
        ("transfers-list", list_fn, 'source_scope: "flutterwave_only"'),
        ("transfers-list", list_fn, "filters_locked_to_source: true"),
        ("transfers-list", list_fn, "response_contract_version: 1"),
        ("transfers-list", list_fn, "contract_generated_at: new Date().toISOString()"),
        ("transfers-list", list_fn, 'provider: "flutterwave"'),
        ("transfers-list", list_fn, '.eq("source", "flutterwave")'),
        ("transfers-list", list_fn, "Flutterwave transfer list endpoint is not enabled in this environment."),
        ("transfers-list", list_fn, "direction: effectiveDirection"),
        ("transfers-list", list_fn, "next_before: nextBefore"),
        ("transfers-list", list_fn, "returned_count: rows.length"),
        ("collection-create", collection_create_fn, "flutterwaveCreateCharge"),
        ("collection-create", collection_create_fn, "evaluateProviderCorridorPolicy"),
        ("collection-create", collection_create_fn, 'provider: "flutterwave"'),
        ("collection-create", collection_create_fn, 'create_scope: "collection_create"'),
        ("collection-create", collection_create_fn, 'endpoint: "flutterwave-collection-create"'),
        ("collection-create", collection_create_fn, "response_contract_version: 1"),
        ("collection-create", collection_create_fn, "contract_generated_at: new Date().toISOString()"),
        ("collection-create", collection_create_fn, 'onConflict: "user_id,source,reference"'),
        ("collection-create", collection_create_fn, 'direction: "receive"'),
        ("collection-create", collection_create_fn, 'source: "flutterwave"'),
        ("collection-status", collection_status_fn, "flutterwaveGetCharge"),
        ("collection-status", collection_status_fn, '.eq("direction", "receive")'),
        ("collection-status", collection_status_fn, '.eq("source", "flutterwave")'),
        ("collection-status", collection_status_fn, "local_transfer_id"),
        ("collection-status", collection_status_fn, 'endpoint: "flutterwave-collection-status"'),
        ("collection-status", collection_status_fn, 'status_scope: "collection"'),
        ("collection-status", collection_status_fn, "response_contract_version: 1"),
        ("collection-status", collection_status_fn, "contract_generated_at: new Date().toISOString()"),
        ("collection-status", collection_status_fn, 'provider: "flutterwave"'),
        ("collection-status", collection_status_fn, "source_locked_to_flutterwave: true"),
        ("collection-status", collection_status_fn, "capabilities: caps"),
        ("collection-status", collection_status_fn, "channel: row.channel || null"),
        ("collection-status", collection_status_fn, "provider_status: providerStatus || null"),
        ("collection-status", collection_status_fn, 'status_source: providerStatus ? "provider" : "local"'),
        ("collections-list", collections_list_fn, '.eq("user_id", authData.user.id)'),
        ("collections-list", collections_list_fn, '.eq("direction", "receive")'),
        ("collections-list", collections_list_fn, "ALLOWED_STATUS"),
        ("collections-list", collections_list_fn, "ALLOWED_CHANNEL"),
        ("collections-list", collections_list_fn, 'endpoint: "flutterwave-collections-list"'),
        ("collections-list", collections_list_fn, 'list_scope: "collections"'),
        ("collections-list", collections_list_fn, 'source_scope: "flutterwave_only"'),
        ("collections-list", collections_list_fn, "filters_locked_to_source: true"),
        ("collections-list", collections_list_fn, "response_contract_version: 1"),
        ("collections-list", collections_list_fn, "contract_generated_at: new Date().toISOString()"),
        ("collections-list", collections_list_fn, 'provider: "flutterwave"'),
        ("collections-list", collections_list_fn, '.eq("source", "flutterwave")'),
        ("collections-list", collections_list_fn, '"source",'),
        ("collections-list", collections_list_fn, 'direction: "receive"'),
        ("collections-list", collections_list_fn, "next_before: nextBefore"),
        ("collections-list", collections_list_fn, "returned_count: rows.length"),
        ("webhook", webhook_fn, "verifyFlutterwaveWebhookSignature"),
        ("webhook", webhook_fn, "flutterwave_webhook_events"),
        ("webhook", webhook_fn, "flutterwave_transfers"),
        ("webhook", webhook_fn, '.eq("source", "flutterwave")'),
        ("webhook", webhook_fn, "signature_ok: true"),
        ("webhook", webhook_fn, 'endpoint: "flutterwave-webhook"'),
        ("webhook", webhook_fn, 'webhook_mode: "accept_and_reconcile"'),
        ("webhook", webhook_fn, 'processing_scope: "webhook_event"'),
        ("webhook", webhook_fn, 'provider: "flutterwave"'),
        ("webhook", webhook_fn, 'webhook_scope: "money_movement"'),
        ("webhook", webhook_fn, "response_contract_version: 1"),
        ("webhook", webhook_fn, "contract_generated_at: new Date().toISOString()"),
        ("webhook", webhook_fn, 'event_classification: transferEventEligible ? "money_movement" : "non_money_movement"'),
        ("webhook", webhook_fn, "headers_captured: true"),
        ("webhook", webhook_fn, "payload_persisted: true"),
        ("webhook", webhook_fn, "signature_verified: true"),
        ("webhook", webhook_fn, "replay_window_enforced: true"),
        ("webhook", webhook_fn, "processing_status: processingStatus"),
    ]:
        if token not in content:
            fail(f"{label} missing token: {token}")
            failed = True
        else:
            ok(f"{label} token found: {token}")

    if failed:
        print("flutterwave_backend_contract_audit: FAIL")
        return 1
    print("flutterwave_backend_contract_audit: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
