#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
gateway = (ROOT / "supabase/functions/public-api-gateway/index.ts").read_text()
gates = (ROOT / "supabase/functions/_shared/api-release-gates.ts").read_text()
validators = (ROOT / "supabase/functions/_shared/api-gateway-validators.ts").read_text()

def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")

va = gateway.split('routeKey === "POST /v1/virtual-accounts"', 1)[1].split('routeKey === "POST /v1/transfers"', 1)[0]
movement = gateway.split('routeKey === "POST /v1/transfers"', 1)[1].split('routeKey === "POST /v1/webhooks"', 1)[0]

require("API_PARTNER_MONEY_MOVEMENT_ENABLED" in gates and "money_movement_locked" in gates,
        "money movement has an independent fail-closed runtime gate")
require("destination.bridge_wallet_id is required" in validators and "destination.address is required" not in validators,
        "virtual account contract requires a Bridge settlement wallet")
require(va.find('"wallet"') < va.find("bridgeProvider.createVirtualAccount("),
        "settlement wallet ownership is checked before virtual-account creation")
require("virtual_account_fiat_business" in va and "virtual_account_fiat_individual" in va,
        "virtual-account fee is derived server-side by authoritative account type")
require('validateTransferOrPayout(body, routeKind)' in movement,
        "transfer and payout use route-specific contracts")
require(movement.find("authorizeSingleTransferAmount(") < movement.find("bridgeProvider.createTransfer("),
        "mandatory tenant cap is enforced before provider transfer")
require(movement.find("assertSpendableWalletBalance(") < movement.find("bridgeProvider.createTransfer("),
        "wallet balance is authorized before provider transfer")
require("Body idempotency_key must match the Idempotency-Key header" in movement and
        "borderpay:api:${ctx.tenantId}:${ctx.idempotencyKey}" in movement,
        "provider idempotency is header-bound and tenant-namespaced")
require("external_account_offramp" in movement and "fixedFeeForPercent(" in movement,
        "payout fee is computed from the server schedule")
require("caller-supplied fees" in validators and "bank details" in validators and "raw addresses" in validators,
        "unowned financial destinations and caller fees are rejected")
