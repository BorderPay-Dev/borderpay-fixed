#!/usr/bin/env python3
"""Guard trust-sensitive financial UX copy.

Live financial/account actions must not show generic infrastructure blame such
as "our servers are not connected". Expected business states need controlled
copy: request received, verification required, coming soon, or retry.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

RUNTIME_DIRS = [
    ROOT / "components",
    ROOT / "utils",
    ROOT / "supabase" / "functions",
]

RUNTIME_EXTS = {".ts", ".tsx", ".js", ".jsx"}

BANNED_COPY = [
    re.compile(r"unable\s+to\s+(connect|reach)\s+to?\s*our\s+servers", re.I),
    re.compile(r"our\s+servers?\s+(are\s+)?not\s+connected", re.I),
    re.compile(r"servers?\s+(are\s+)?not\s+connected", re.I),
    re.compile(r"servers?\s+are\s+not\s+available\s+this\s+time", re.I),
    re.compile(r"not\s+connected\s+this\s+time", re.I),
]

REQUIRED_FILES = {
    "utils/virtualAccountActivationCopy.ts": [
        "virtualAccountActivationMessage",
        "va_grant_pending",
        "virtual_account_setup_pending",
        "country_rail_not_supported",
        "Could not complete request",
    ],
    "components/wallet/AddWalletScreen.tsx": [
        "virtualAccountActivationMessage",
        "showToast[mapped.type]",
    ],
    "components/dashboard/bridge/BridgeVirtualAccountsCard.tsx": [
        "virtualAccountActivationMessage",
        "showToast[mapped.type]",
    ],
    "components/wallet/RequestProvisioningModal.tsx": [
        "virtualAccountActivationMessage",
        "showToast[mapped.type]",
    ],
    "supabase/functions/bridge-virtual-account/index.ts": [
        "virtual_account_setup_pending",
        "pending_va_requests",
        "bridge_va_destination_config_missing",
    ],
}

FORBIDDEN_STRUCTURAL = {
    "components/wallet/AddWalletScreen.tsx": [
        "showToast.error(msg)",
        "friendlyError(res?.error, `Could not open",
    ],
    "components/dashboard/bridge/BridgeVirtualAccountsCard.tsx": [
        "showToast.error(friendlyError(r.error",
        "showToast.error(friendlyError(r?.error",
    ],
}


def iter_runtime_files() -> list[Path]:
    files: list[Path] = []
    for base in RUNTIME_DIRS:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in RUNTIME_EXTS:
                continue
            if any(part in {"node_modules", ".git"} for part in path.parts):
                continue
            files.append(path)
    return files


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def main() -> int:
    failures: list[str] = []

    for path in iter_runtime_files():
        text = path.read_text(errors="replace")
        for pattern in BANNED_COPY:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                failures.append(f"{rel(path)}:{line}: banned trust-damaging copy: {match.group(0)!r}")

    for file_name, needles in REQUIRED_FILES.items():
        path = ROOT / file_name
        if not path.exists():
            failures.append(f"{file_name}: required trust-copy guard file missing")
            continue
        text = path.read_text(errors="replace")
        for needle in needles:
            if needle not in text:
                failures.append(f"{file_name}: missing required guard marker {needle!r}")

    for file_name, needles in FORBIDDEN_STRUCTURAL.items():
        path = ROOT / file_name
        if not path.exists():
            continue
        text = path.read_text(errors="replace")
        for needle in needles:
            if needle in text:
                failures.append(f"{file_name}: forbidden virtual-account error pattern {needle!r}")

    if failures:
        print("Trust-copy regression audit failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print("Trust-copy regression audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
