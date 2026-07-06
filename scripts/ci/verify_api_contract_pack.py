#!/usr/bin/env python3
"""
Fail-fast API contract pack verifier.

Checks:
- OpenAPI v1 exists and contains required paths + error codes.
- Postman collection JSON parses with expected request names.
- Curl cookbook contains key section markers.
- SDK starter structure exists.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
OPENAPI = ROOT / "docs" / "api" / "openapi-v1.yaml"
POSTMAN = ROOT / "docs" / "api" / "postman" / "BorderPay_API_v1.postman_collection.json"
CURL_BOOK = ROOT / "docs" / "api" / "curl" / "API_V1_CURL_COOKBOOK.md"
CHANGELOG = ROOT / "docs" / "api" / "CHANGELOG.md"
SDK_DIR = ROOT / "docs" / "api" / "sdk" / "typescript"


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def parse_openapi_light(yaml_text: str) -> dict[str, Any]:
    # Lightweight parser assumptions for this repo's stable format.
    # We avoid adding yaml deps in CI gate.
    # Pull version:
    version_match = re.search(r"(?m)^\s*version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$", yaml_text)
    version = version_match.group(1) if version_match else None

    required_paths = [
        "/v1/health",
        "/v1/customers",
        "/v1/wallets",
        "/v1/virtual-accounts",
        "/v1/transfers",
        "/v1/payouts",
        "/v1/webhooks",
    ]

    present_paths = []
    for line in yaml_text.splitlines():
        m = re.match(r"^\s{2}(/v1/[^:]+):\s*$", line)
        if m:
            present_paths.append(m.group(1))

    err_block = re.search(
        r"(?ms)^\s{4}ErrorCode:\s*\n\s{6}type:\s*string\s*\n\s{6}enum:\s*\n(?P<body>(?:\s{8}-\s*[^\n]+\n)+)",
        yaml_text,
    )
    error_codes: list[str] = []
    if err_block:
        for line in err_block.group("body").splitlines():
            m = re.match(r"^\s{8}-\s*(\S+)\s*$", line)
            if m:
                error_codes.append(m.group(1))

    return {
        "version": version,
        "paths": present_paths,
        "required_paths": required_paths,
        "error_codes": error_codes,
    }


def main() -> None:
    if not OPENAPI.exists():
        fail(f"missing {OPENAPI}")
    text = OPENAPI.read_text(encoding="utf-8")
    parsed = parse_openapi_light(text)

    if not parsed["version"]:
        fail("openapi version not found")
    ok(f"openapi version={parsed['version']}")

    for p in parsed["required_paths"]:
        if p not in parsed["paths"]:
            fail(f"required path missing: {p}")
    ok("required v1 paths present")

    required_codes = {
        "unauthorized",
        "forbidden",
        "invalid_request",
        "idempotency_key_required",
        "idempotency_replay_mismatch",
        "not_found",
        "rate_limited",
        "provider_unavailable",
        "provider_error",
        "internal_error",
    }
    codes = set(parsed["error_codes"])
    missing_codes = sorted(required_codes - codes)
    if missing_codes:
        fail(f"missing error codes in openapi: {missing_codes}")
    ok("error code enum matches baseline")

    if not POSTMAN.exists():
        fail(f"missing {POSTMAN}")
    try:
        postman_obj = json.loads(POSTMAN.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"postman json parse failed: {exc}")

    items = postman_obj.get("item", [])
    if not isinstance(items, list) or not items:
        fail("postman collection has no requests")
    names = {str(i.get("name", "")) for i in items if isinstance(i, dict)}
    for expected in ["Gateway Health", "Create Customer", "Create Wallet", "Create Transfer", "Create Webhook Endpoint"]:
        if expected not in names:
            fail(f"postman request missing: {expected}")
    ok("postman collection requests validated")

    if not CURL_BOOK.exists():
        fail(f"missing {CURL_BOOK}")
    cookbook = CURL_BOOK.read_text(encoding="utf-8")
    for marker in ["## 1) Gateway health", "## 2) Create customer", "## 10) Idempotency replay check"]:
        if marker not in cookbook:
            fail(f"curl cookbook marker missing: {marker}")
    ok("curl cookbook markers validated")

    if not CHANGELOG.exists():
        fail(f"missing {CHANGELOG}")
    if "## v1.0.1" not in CHANGELOG.read_text(encoding="utf-8"):
        fail("CHANGELOG missing v1.0.1 entry")
    ok("api changelog contains v1.0.1")

    required_sdk_files = [
        SDK_DIR / "package.json",
        SDK_DIR / "tsconfig.json",
        SDK_DIR / "src" / "client.ts",
        SDK_DIR / "src" / "types.ts",
        SDK_DIR / "src" / "webhook.ts",
        SDK_DIR / "src" / "index.ts",
        SDK_DIR / "README.md",
    ]
    missing = [str(p) for p in required_sdk_files if not p.exists()]
    if missing:
        fail(f"missing sdk files: {missing}")
    ok("sdk starter structure validated")

    print("api_contract_pack: PASS")


if __name__ == "__main__":
    main()
