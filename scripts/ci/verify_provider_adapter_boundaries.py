#!/usr/bin/env python3
"""
Fail CI if provider HTTP calls bypass the shared provider adapters.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]

ALLOWED_BRIDGE = {
    "supabase/functions/_shared/providers/bridge-client.ts",
    "supabase/functions/bridge-kyc-link/index.ts",
    "supabase/functions/bridge-kyb-link/index.ts",
    "supabase/functions/bridge-external-account/index.ts",
    "supabase/functions/bridge-ping/index.ts",
    "supabase/functions/subscription-upgrade/index.ts",
    "utils/featureFlags.ts",
}
ALLOWED_YELLOW_CARD = {
    "supabase/functions/_shared/providers/yellowcard-client.ts",
}

BRIDGE_PATTERNS = [
    re.compile(r"https://api\.bridge\.xyz", re.IGNORECASE),
    re.compile(r"\bBRIDGE_API_KEY\b"),
]
YELLOW_CARD_PATTERNS = [
    re.compile(r"https://.*yellowcard", re.IGNORECASE),
    re.compile(r"\bYELLOW_CARD_API_KEY\b"),
]

violations = []

for path in ROOT.rglob("*.ts"):
    rel = str(path.relative_to(ROOT)).replace("\\", "/")
    if rel.startswith("node_modules/") or rel.startswith("dist/"):
        continue
    text = path.read_text(encoding="utf-8", errors="ignore")
    for pat in BRIDGE_PATTERNS:
        if pat.search(text) and rel not in ALLOWED_BRIDGE:
            violations.append((rel, f"bridge boundary violation: pattern `{pat.pattern}`"))
            break
    for pat in YELLOW_CARD_PATTERNS:
        if pat.search(text) and rel not in ALLOWED_YELLOW_CARD:
            violations.append((rel, f"Yellow Card boundary violation: pattern `{pat.pattern}`"))
            break

if violations:
    print("Provider adapter boundary violations:")
    for rel, msg in sorted(violations):
        print(f" - {rel}: {msg}")
    sys.exit(1)

print("PASS: provider adapter boundaries intact.")
