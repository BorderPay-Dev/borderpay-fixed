#!/usr/bin/env python3
"""
Public provider privacy audit.

BorderPay is the public product brand. Provider names and provider-generic
phrasing belong in internal docs, audits, code identifiers, and backend
contracts, not in customer-facing UI copy.

This audit scans customer-facing component source and i18n strings with
comments/import paths stripped. It intentionally allows code identifiers like
BridgeVirtualAccountsCard, bridge_kyc_status, backendAPI.bridge, and test/docs
files; it blocks visible copy such as "Bridge is reviewing...", "handled by
Bridge", "local-rails partner", or "banking partner".
"""
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

PUBLIC_PATHS = [
    ROOT / "components",
    ROOT / "utils/i18n/translations.ts",
]

FORBIDDEN = re.compile(
    r"\bBridge\b|\bYellow Card\b|\bFlutterwave\b|\bMaplerad\b|\bmaplerad\b|"
    r"\bbanking-as-a-service partner\b|"
    r"\bbanking partner\b|"
    r"\blocal payments partner\b|"
    r"\blocal-rails partner\b|"
    r"\bAfrican partner\b|"
    r"\bpartner integration\b|"
    r"\bour partner\b|"
    r"\bverification partner\b|"
    r"\bregulated identity partner\b|"
    r"\bhandled by Bridge\b|"
    r"\bthrough Bridge\b|"
    r"\bwith Bridge\b|"
    r"\bby Bridge\b|"
    r"\bBridge-supported\b|"
    r"\bBridge-backed\b"
)


def strip_comments_and_imports(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.MULTILINE)
    src = re.sub(r"//.*$", "", src, flags=re.MULTILINE)
    src = re.sub(r"^\s*import\s+.*?;\s*$", "", src, flags=re.MULTILINE | re.DOTALL)
    return src


def line_no(src: str, pos: int) -> int:
    return src[:pos].count("\n") + 1


def main() -> int:
    findings: list[str] = []
    files: list[Path] = []
    for p in PUBLIC_PATHS:
        if p.is_dir():
            files.extend(sorted(p.rglob("*.tsx")))
            files.extend(sorted(p.rglob("*.ts")))
        else:
            files.append(p)

    for path in files:
        rel = path.relative_to(ROOT)
        src = path.read_text()
        cleaned = strip_comments_and_imports(src)
        for m in FORBIDDEN.finditer(cleaned):
            findings.append(f"{rel}:{line_no(cleaned, m.start())}: public provider wording: {m.group(0)!r}")

    if findings:
        print("FAIL: public provider privacy audit")
        for f in findings:
            print("  " + f)
        return 1
    print("PASS: public provider privacy audit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
