#!/usr/bin/env python3
"""Fail-fast verifier for API webhook mock fixtures."""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "docs" / "api" / "mocks" / "webhooks"
REQUIRED = [
    "transfer.completed.json",
    "transfer.failed.json",
    "customer.verification.updated.json",
]
ISO_8601_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def validate_fixture(path: pathlib.Path) -> None:
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        fail(f"{path.name}: must be a JSON object")

    for key in ("id", "type", "created_at", "data"):
        if key not in obj:
            fail(f"{path.name}: missing key '{key}'")

    if not str(obj["id"]).startswith("evt_"):
        fail(f"{path.name}: id must start with evt_")

    event_type = str(obj["type"]).strip()
    if not event_type:
        fail(f"{path.name}: type cannot be empty")

    created_at = str(obj["created_at"]).strip()
    if not ISO_8601_Z.match(created_at):
        fail(f"{path.name}: created_at must be RFC3339 UTC (YYYY-MM-DDTHH:MM:SSZ)")

    if not isinstance(obj["data"], dict):
        fail(f"{path.name}: data must be an object")


def main() -> None:
    if not FIXTURE_DIR.exists():
        fail(f"missing fixture directory: {FIXTURE_DIR}")

    for filename in REQUIRED:
        p = FIXTURE_DIR / filename
        if not p.exists():
            fail(f"missing fixture file: {filename}")
        validate_fixture(p)

    readme = FIXTURE_DIR / "README.md"
    if not readme.exists():
        fail("missing docs/api/mocks/webhooks/README.md")

    ok("webhook mock fixture pack validated")
    print("api_mock_fixtures: PASS")


if __name__ == "__main__":
    main()
