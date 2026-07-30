#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
contract = (ROOT / "supabase/functions/_shared/bridge-payload-contract.ts").read_text()
ingress = (ROOT / "supabase/functions/_shared/bridge-ingress-evaluator.ts").read_text()

failures = []

if "function isStaticTransferTemplate" not in contract:
    failures.append("Bridge payload contract must detect static transfer templates / payment routes.")
if "payload_contract_static_template_log_only" not in contract:
    failures.append("Static transfer template events must be accepted as log-only, not rejected for missing amount/currency.")
if "payload_contract_liquidation_address_log_only" not in contract:
    failures.append("Liquidation address creation events must be accepted as log-only.")
if "bridge.liquidation_address" not in ingress:
    failures.append("Ingress evaluator must classify liquidation address / drain events.")
if "invalid_payload_contract_missing_drain_state" not in contract:
    failures.append("Liquidation drain events must require a state before processing.")
if "invalid_payload_contract_missing_transfer_amount_or_currency" not in contract:
    failures.append("Real transfer.created/updated events must still reject missing amount/currency.")
if 'routing_target?: IngressRoutingTarget' not in contract:
    failures.append("Payload contract must be able to override routing target for route/template events.")
if 'contract.routing_target === "log_only"' not in ingress:
    failures.append("Ingress evaluator must honor log-only routing returned by payload contract.")

if failures:
    print("bridge_static_template_webhook_contract_audit: FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("bridge_static_template_webhook_contract_audit: PASS")
