#!/usr/bin/env python3
"""Static safety contract for the operator-only Bridge fee account endpoint."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "supabase/functions/admin-bridge-fee-account/index.ts").read_text()
CONFIG = (ROOT / "supabase/config.toml").read_text()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require('Deno.env.get("BRIDGE_FEE_API_KEY")' in SOURCE,
        "endpoint must use the isolated fee configuration key")
require('Deno.env.get("BRIDGE_API_KEY")' not in SOURCE,
        "endpoint must not use or replace the customer-traffic Bridge key")
require('.from("admin_users")' in SOURCE and 'error: "admin only"' in SOURCE,
        "endpoint must verify admin_users membership")
require('body.confirm !== "CONFIGURE_FEE_EXTERNAL_ACCOUNT"' in SOURCE,
        "configuration must require explicit confirmation")
require('req.headers.get("Idempotency-Key")' in SOURCE,
        "configuration must require caller-provided idempotency")
require('method = action === "status" ? "GET" : "POST"' in SOURCE,
        "status must remain read-only and configure must use POST")
require("routing_number" not in SOURCE.split("console.info", 1)[1],
        "audit log must not include routing numbers")
require("account_number" not in SOURCE.split("console.info", 1)[1],
        "audit log must not include account numbers")
require("[functions.admin-bridge-fee-account]" in CONFIG and "verify_jwt = true" in CONFIG,
        "Supabase must enforce JWT before the in-function admin check")

print("bridge fee account admin audit: PASS")
