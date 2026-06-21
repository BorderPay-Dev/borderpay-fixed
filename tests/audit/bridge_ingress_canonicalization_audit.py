#!/usr/bin/env python3
"""Audit that ingress decisioning is canonicalized through a shared evaluator."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "supabase/functions/_shared/bridge-ingress-evaluator.ts"
WH = ROOT / "supabase/functions/bridge-webhook/index.ts"
SYN = ROOT / "supabase/functions/bridge-test-webhook/index.ts"
WORKER = ROOT / "supabase/functions/process-pending-events/index.ts"

files = {
    "evaluator": EVAL.read_text(encoding="utf-8") if EVAL.exists() else "",
    "webhook": WH.read_text(encoding="utf-8") if WH.exists() else "",
    "synthetic": SYN.read_text(encoding="utf-8") if SYN.exists() else "",
    "worker": WORKER.read_text(encoding="utf-8") if WORKER.exists() else "",
}

checks = [
    ("C1 evaluator file exists", EVAL.exists()),
    ("C2 evaluator exports evaluateBridgeIngressEvent", "export function evaluateBridgeIngressEvent" in files["evaluator"]),
    ("C2b evaluator exports assertion + source marker", "assertBridgeIngressDecision" in files["evaluator"] and "BRIDGE_INGRESS_DECISION_SOURCE" in files["evaluator"]),
    ("C3 production webhook imports evaluator", "bridge-ingress-evaluator" in files["webhook"]),
    ("C4 production webhook calls evaluator", "evaluateBridgeIngressEvent(" in files["webhook"]),
    ("C4b production webhook asserts decision boundary", "assertBridgeIngressDecision(" in files["webhook"]),
    ("C5 synthetic ingress imports evaluator", "bridge-ingress-evaluator" in files["synthetic"]),
    ("C6 synthetic ingress calls evaluator", "evaluateBridgeIngressEvent(" in files["synthetic"]),
    ("C6b synthetic ingress asserts decision boundary", "assertBridgeIngressDecision(" in files["synthetic"]),
    ("C7 worker imports evaluator", "bridge-ingress-evaluator" in files["worker"]),
    ("C8 worker route selection uses evaluator output", "route_bucket" in files["worker"] and "evaluateBridgeIngressEvent(" in files["worker"]),
    ("C8b worker asserts decision boundary", "assertBridgeIngressDecision(" in files["worker"]),
]

print("bridge_ingress_canonicalization_audit:")
failed = []
for name, ok in checks:
    print(f"  {'PASS' if ok else 'FAIL'} {name}")
    if not ok:
        failed.append(name)

if failed:
    print("\nFailures:")
    for x in failed:
        print(f" - {x}")
    sys.exit(1)
