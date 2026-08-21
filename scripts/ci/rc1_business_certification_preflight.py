#!/usr/bin/env python3
"""Offline, fail-closed preflight for RC1 production certification capture.

This command never connects to Supabase or a provider.  It validates supplied
build/deployment identity, repository immutability, provenance availability and
surface-specific operation approvals before a capture tool may start.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
FORBIDDEN_VALUE_RE = re.compile(r"(?:^|[-_\s])(placeholder|example|sample|mock|fake|todo|tbd|unknown)(?:$|[-_\s])", re.I)

SURFACES = {
    "dashboard", "treasury", "wallets", "receive", "send", "transactions",
    "notifications", "team", "settings", "external-accounts", "business-profile",
}
APPROVAL_SURFACES = {"receive", "send", "external-accounts"}

# None means the repository has no durable authoritative source for the claim.
# Capture remains blocked until that data contract is established independently.
PROVENANCE_SOURCES: dict[str, str | None] = {
    "account_type": "public.user_profiles.account_type",
    "created_via": "public.account_origin_provenance.origin_kind",
    "email_verified": "auth.users.email_confirmed_at",
    "kyb_approved": "public.business_profiles.bridge_kyb_status",
    "bridge_customer_id": "public.user_profiles.bridge_customer_id",
    "is_operator_account": "public.operator_bridge_accounts.active",
    "is_imported_account": "public.account_origin_provenance.origin_kind",
}


def parse_utc(value: object) -> dt.datetime | None:
    if not isinstance(value, str) or not ISO_UTC_RE.fullmatch(value):
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def meaningful(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not FORBIDDEN_VALUE_RE.search(value.strip())


def repository_state(root: Path) -> tuple[str | None, list[str]]:
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True, capture_output=True,
    )
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=root, text=True, capture_output=True,
    )
    if sha.returncode != 0 or status.returncode != 0:
        return None, ["git repository identity unavailable"]
    dirty = []
    for line in status.stdout.splitlines():
        path = line[3:].strip()
        if path.startswith("artifacts/business-certification/"):
            continue
        dirty.append(line)
    return sha.stdout.strip(), dirty


def validate_preflight(
    data: object,
    *,
    surface: str,
    repository_sha: str | None,
    dirty_paths: list[str],
) -> list[str]:
    failures: list[str] = []
    if surface != "all" and surface not in SURFACES:
        return [f"unknown certification surface: {surface}"]
    if not isinstance(data, dict):
        return ["preflight JSON root must be an object"]

    rc1_sha = data.get("rc1_git_commit")
    build_id = data.get("build_id")
    build_artifact_sha256 = data.get("build_artifact_sha256")
    if not isinstance(rc1_sha, str) or not SHA_RE.fullmatch(rc1_sha):
        failures.append("rc1_git_commit must be an immutable 40-character lowercase git SHA")
    if repository_sha is None or not SHA_RE.fullmatch(repository_sha):
        failures.append("current repository HEAD is unavailable or invalid")
    elif rc1_sha != repository_sha:
        failures.append("rc1_git_commit does not match the checked-out RC1 HEAD")
    if dirty_paths:
        failures.append("RC1 source tree has non-evidence changes; commit identity is not immutable")
    if not meaningful(build_id):
        failures.append("build_id must be a recorded non-placeholder identifier")
    if not isinstance(build_artifact_sha256, str) or not SHA256_RE.fullmatch(build_artifact_sha256):
        failures.append("build_artifact_sha256 must be a recorded SHA-256 digest")

    attestation = data.get("deployment_attestation")
    if not isinstance(attestation, dict):
        failures.append("deployment_attestation object is required")
    else:
        for key in ("attestation_id", "attested_by"):
            if not meaningful(attestation.get(key)):
                failures.append(f"deployment_attestation.{key} must be non-placeholder")
        if attestation.get("environment") != "production":
            failures.append("deployment_attestation.environment must be production")
        if attestation.get("deployed_git_commit") != rc1_sha:
            failures.append("deployed_git_commit must equal rc1_git_commit")
        if attestation.get("deployed_build_id") != build_id:
            failures.append("deployed_build_id must equal build_id")
        if attestation.get("deployed_build_artifact_sha256") != build_artifact_sha256:
            failures.append("deployed_build_artifact_sha256 must equal build_artifact_sha256")
        if parse_utc(attestation.get("attested_at")) is None:
            failures.append("deployment_attestation.attested_at must be ISO UTC")

    provenance = data.get("provenance")
    if not isinstance(provenance, dict):
        failures.append("provenance object is required")
    else:
        account_ids: set[str] = set()
        for claim, authoritative_source in PROVENANCE_SOURCES.items():
            item = provenance.get(claim)
            if authoritative_source is None:
                failures.append(f"{claim} has no durable authoritative source in the repository")
                continue
            if not isinstance(item, dict):
                failures.append(f"provenance.{claim} object is required")
                continue
            if item.get("source") != authoritative_source:
                failures.append(f"provenance.{claim}.source must be {authoritative_source}")
            if not meaningful(item.get("account_id")):
                failures.append(f"provenance.{claim}.account_id must be non-placeholder")
            else:
                account_ids.add(str(item["account_id"]).strip())
            if parse_utc(item.get("captured_at")) is None:
                failures.append(f"provenance.{claim}.captured_at must be ISO UTC")
            value = item.get("value")
            if claim == "account_type" and value != "business":
                failures.append("provenance.account_type.value must be business")
            elif claim == "created_via" and value != "direct":
                failures.append("provenance.created_via.value must be direct")
            elif claim == "email_verified" and value is not True:
                failures.append("provenance.email_verified.value must be true")
            elif claim == "kyb_approved" and str(value).lower() not in {
                "approved", "kyb_approved", "business_verification_approved",
            }:
                failures.append("provenance.kyb_approved.value must be an approved status")
            elif claim == "bridge_customer_id" and not meaningful(value):
                failures.append("provenance.bridge_customer_id.value must be non-placeholder")
            elif claim == "is_operator_account" and value is not False:
                failures.append("provenance.is_operator_account.value must be false")
            elif claim == "is_imported_account" and value is not False:
                failures.append("provenance.is_imported_account.value must be false")
        if len(account_ids) > 1:
            failures.append("provenance account IDs do not match")

    manual_audit = data.get("manual_intervention_audit")
    if not isinstance(manual_audit, dict):
        failures.append("manual_intervention_audit configuration is required")
    else:
        if manual_audit.get("authority_status") != "EXTERNAL_PROVIDER_AUDIT_EXPORT":
            failures.append("manual intervention authority must be EXTERNAL_PROVIDER_AUDIT_EXPORT")
        if manual_audit.get("source") != "supabase_postgres_pgaudit_export":
            failures.append("manual intervention source must be supabase_postgres_pgaudit_export")
        if not isinstance(manual_audit.get("project_ref"), str) or not re.fullmatch(r"[a-z]{20}", manual_audit["project_ref"]):
            failures.append("manual intervention project_ref must be a 20-character Supabase project ref")
        config = manual_audit.get("pgaudit_configuration")
        if not isinstance(config, dict):
            failures.append("manual intervention pgaudit_configuration is required")
        else:
            classes = {item.strip().lower() for item in str(config.get("pgaudit.log", "")).split(",")}
            if not {"write", "ddl", "role"}.issubset(classes):
                failures.append("pgaudit.log must include write, ddl, and role")
            if str(config.get("pgaudit.log_parameter", "")).lower() != "on":
                failures.append("pgaudit.log_parameter must be on")
            if str(config.get("pgaudit.log_relation", "")).lower() != "on":
                failures.append("pgaudit.log_relation must be on")
            if "pgaudit" not in str(config.get("shared_preload_libraries", "")).lower():
                failures.append("shared_preload_libraries must contain pgaudit")
            if parse_utc(config.get("captured_at")) is None:
                failures.append("pgaudit configuration captured_at must be ISO UTC")

    required_approvals = APPROVAL_SURFACES if surface == "all" else ({surface} & APPROVAL_SURFACES)
    approvals = data.get("operation_authorizations")
    if required_approvals and not isinstance(approvals, dict):
        failures.append("operation_authorizations object is required for state-changing surfaces")
    elif isinstance(approvals, dict):
        for operation in sorted(required_approvals):
            approval = approvals.get(operation)
            if not isinstance(approval, dict):
                failures.append(f"explicit authorization missing for {operation}")
                continue
            if approval.get("approved") is not True:
                failures.append(f"{operation} authorization is not explicitly approved")
            for key in ("authorization_id", "approved_by"):
                if not meaningful(approval.get(key)):
                    failures.append(f"{operation}.{key} must be non-placeholder")
            if parse_utc(approval.get("approved_at")) is None:
                failures.append(f"{operation}.approved_at must be ISO UTC")
            if not meaningful(approval.get("reconciliation_plan_id")):
                failures.append(f"{operation}.reconciliation_plan_id must be non-placeholder")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="operator-supplied preflight JSON")
    parser.add_argument("--surface", choices=["all", *sorted(SURFACES)], required=True)
    args = parser.parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"[FAIL] missing preflight input: {args.input}")
        return 1
    except json.JSONDecodeError as exc:
        print(f"[FAIL] malformed preflight JSON: {exc}")
        return 1

    sha, dirty = repository_state(ROOT)
    failures = validate_preflight(data, surface=args.surface, repository_sha=sha, dirty_paths=dirty)
    if failures:
        for failure in failures:
            print(f"[FAIL] {failure}")
        print("\nrc1_business_certification_preflight: BLOCKED")
        return 1
    print("rc1_business_certification_preflight: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
