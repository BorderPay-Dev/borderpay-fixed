#!/usr/bin/env python3
"""Block releases unless KYB callback tests cover every supported client."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TEST_FILE = ROOT / "tests/unit/bridge_verification_url_test.ts"
PLATFORMS = ("Android", "iPhone", "PWA", "Web")


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


source = TEST_FILE.read_text(encoding="utf-8")
for platform in PLATFORMS:
    names = re.findall(
        rf'Deno\.test\("\[{re.escape(platform)} ([1-5])/5\]',
        source,
    )
    if sorted(names) != ["1", "2", "3", "4", "5"]:
        fail(f"{platform} must have five independently named gates; found {names}")

result = subprocess.run(
    ["deno", "test", "--quiet", str(TEST_FILE)],
    cwd=ROOT,
    text=True,
    capture_output=True,
    check=False,
)
if result.returncode != 0:
    fail((result.stdout + "\n" + result.stderr).strip())

print("PASS: 20/20 cross-platform KYB callback gates (5 each) and core tests")
