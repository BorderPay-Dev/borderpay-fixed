#!/usr/bin/env python3
"""Fail-closed verifier for Supabase pgaudit certification-window exports."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path


METADATA_FILE = "manual_intervention_audit.json"
DEFAULT_EXPORT_FILE = "manual-intervention-pgaudit-export.json"
SOURCE = "supabase_postgres_pgaudit_export"
AUTHORITY_STATUS = "EXTERNAL_PROVIDER_AUDIT_EXPORT"
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PROJECT_REF_RE = re.compile(r"^[a-z]{20}$")
PLACEHOLDER_RE = re.compile(r"(?:^|[-_\s])(placeholder|example|sample|mock|fake|todo|tbd|unknown)(?:$|[-_\s])", re.I)

# These roles can make control-plane/SQL-editor changes outside normal app paths.
PRIVILEGED_ACTORS = {
    "postgres", "supabase_admin", "dashboard_user", "supabase_read_only_user",
}
CRITICAL_RELATIONS = {
    "auth.users",
    "public.user_profiles",
    "public.business_profiles",
    "public.account_origin_provenance",
    "public.operator_bridge_accounts",
    "public.bridge_customers",
    "public.bridge_wallets",
    "public.bridge_virtual_accounts",
    "public.bridge_external_accounts",
    "public.wallets",
    "public.transactions",
}
WRITE_TOKENS = ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "MERGE", "COPY", "DDL", "ROLE")


def _time(value: object) -> dt.datetime | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = float(value)
        if numeric > 10**14:
            numeric /= 1_000_000
        elif numeric > 10**11:
            numeric /= 1_000
        try:
            return dt.datetime.fromtimestamp(numeric, tz=dt.timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not ISO_RE.fullmatch(value):
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def _meaningful(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not PLACEHOLDER_RE.search(value.strip())


def _read_object(path: Path, failures: list[str]) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        failures.append(f"missing manual-intervention audit file: {path.name}")
        return None
    except json.JSONDecodeError as exc:
        failures.append(f"malformed manual-intervention audit JSON {path.name}: {exc}")
        return None
    if not isinstance(value, dict) or not value:
        failures.append(f"manual-intervention audit object must be non-empty: {path.name}")
        return None
    return value


def _record_text(record: dict) -> str:
    return json.dumps(record, sort_keys=True, separators=(",", ":"))


def _nested_values(value: object, keys: set[str]) -> list[object]:
    found: list[object] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in keys:
                found.append(nested)
            found.extend(_nested_values(nested, keys))
    elif isinstance(value, list):
        for nested in value:
            found.extend(_nested_values(nested, keys))
    return found


def _record_actor(record: dict) -> str:
    for value in _nested_values(record, {"user_name", "username", "role", "database_user"}):
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    return ""


def _record_time(record: dict) -> dt.datetime | None:
    for value in _nested_values(record, {"timestamp", "recorded_at", "event_timestamp"}):
        parsed = _time(value)
        if parsed is not None:
            return parsed
    return None


def validate_manual_intervention_audit(
    root: Path,
    *,
    expected_account_id: str | None = None,
    expected_capture_id: str | None = None,
) -> list[str]:
    failures: list[str] = []
    metadata = _read_object(root / METADATA_FILE, failures)
    if metadata is None:
        return failures

    if metadata.get("authority_status") != AUTHORITY_STATUS:
        failures.append(f"manual audit authority_status must be {AUTHORITY_STATUS}")
    if metadata.get("source") != SOURCE:
        failures.append(f"manual audit source must be {SOURCE}")
    project_ref = metadata.get("project_ref")
    if not isinstance(project_ref, str) or not PROJECT_REF_RE.fullmatch(project_ref):
        failures.append("manual audit project_ref must be a 20-character Supabase project ref")
    account_id = metadata.get("account_id")
    capture_id = metadata.get("capture_id")
    if not _meaningful(account_id):
        failures.append("manual audit account_id must be non-placeholder")
    if not _meaningful(capture_id):
        failures.append("manual audit capture_id must be non-placeholder")
    if expected_account_id is not None and account_id != expected_account_id:
        failures.append("manual audit account_id does not match certification account")
    if expected_capture_id is not None and capture_id != expected_capture_id:
        failures.append("manual audit capture_id does not match capture context")
    for field in ("provider_export_id", "provider_query_id", "exported_by"):
        if not _meaningful(metadata.get(field)):
            failures.append(f"manual audit {field} must be non-placeholder")

    window_start = _time(metadata.get("window_start"))
    window_end = _time(metadata.get("window_end"))
    exported_at = _time(metadata.get("exported_at"))
    if window_start is None or window_end is None or window_start >= window_end:
        failures.append("manual audit requires an ordered ISO UTC capture window")
    if exported_at is None or (window_end is not None and exported_at < window_end):
        failures.append("manual audit exported_at must be ISO UTC at or after window_end")

    config = metadata.get("pgaudit_configuration")
    if not isinstance(config, dict):
        failures.append("manual audit pgaudit_configuration object is required")
    else:
        classes = {item.strip().lower() for item in str(config.get("pgaudit.log", "")).split(",")}
        if not {"write", "ddl", "role"}.issubset(classes):
            failures.append("pgaudit.log must include write, ddl, and role")
        if str(config.get("pgaudit.log_parameter", "")).lower() != "on":
            failures.append("pgaudit.log_parameter must be on for certification capture")
        if str(config.get("pgaudit.log_relation", "")).lower() != "on":
            failures.append("pgaudit.log_relation must be on for certification capture")
        if "pgaudit" not in str(config.get("shared_preload_libraries", "")).lower():
            failures.append("shared_preload_libraries must contain pgaudit")
        if _time(config.get("captured_at")) is None:
            failures.append("pgaudit configuration captured_at must be ISO UTC")

    export_name = metadata.get("export_file")
    if export_name != DEFAULT_EXPORT_FILE:
        failures.append(f"manual audit export_file must be {DEFAULT_EXPORT_FILE}")
        export_name = DEFAULT_EXPORT_FILE
    export_path = root / export_name
    try:
        raw = export_path.read_bytes()
    except FileNotFoundError:
        failures.append(f"missing manual-intervention audit file: {export_name}")
        return failures
    expected_hash = metadata.get("export_sha256")
    if not isinstance(expected_hash, str) or not SHA256_RE.fullmatch(expected_hash):
        failures.append("manual audit export_sha256 must be a lowercase SHA-256 digest")
    elif hashlib.sha256(raw).hexdigest() != expected_hash:
        failures.append("manual audit export SHA-256 mismatch")

    try:
        export = json.loads(raw)
    except json.JSONDecodeError as exc:
        failures.append(f"malformed manual-intervention audit JSON {export_name}: {exc}")
        return failures
    if not isinstance(export, dict) or not export:
        failures.append("manual audit export root must be a non-empty object")
        return failures
    if export.get("source") != "supabase.logs.postgres":
        failures.append("manual audit export source must be supabase.logs.postgres")
    if export.get("project_ref") != project_ref:
        failures.append("manual audit export project_ref mismatch")
    if export.get("window_start") != metadata.get("window_start") or export.get("window_end") != metadata.get("window_end"):
        failures.append("manual audit export window mismatch")
    records = export.get("records")
    if not isinstance(records, list) or not records:
        failures.append("manual audit export records must be a non-empty list")
        return failures
    if not all(isinstance(record, dict) and record for record in records):
        failures.append("manual audit export records must be non-empty objects")
        return failures

    start_marker = f"RC1_CERTIFICATION_AUDIT_START:{capture_id}"
    end_marker = f"RC1_CERTIFICATION_AUDIT_END:{capture_id}"
    start_seen = end_seen = False
    for index, record in enumerate(records):
        timestamp = _record_time(record)
        if timestamp is None:
            failures.append(f"manual audit record {index} lacks an ISO UTC timestamp")
            continue
        if window_start is not None and window_end is not None and not (window_start <= timestamp <= window_end):
            failures.append(f"manual audit record {index} falls outside the capture window")
        text = _record_text(record)
        start_seen = start_seen or start_marker in text
        end_seen = end_seen or end_marker in text
        actor = _record_actor(record)
        upper = text.upper()
        critical = any(relation.upper() in upper for relation in CRITICAL_RELATIONS)
        write = any(token in upper for token in WRITE_TOKENS)
        if actor in PRIVILEGED_ACTORS and write and critical:
            failures.append(f"manual audit detected privileged certification-critical mutation in record {index}")
    if not start_seen or not end_seen:
        failures.append("manual audit export must contain matching start and end coverage markers")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--account-id")
    parser.add_argument("--capture-id")
    args = parser.parse_args()
    failures = validate_manual_intervention_audit(
        args.evidence_root,
        expected_account_id=args.account_id,
        expected_capture_id=args.capture_id,
    )
    if failures:
        for failure in failures:
            print(f"[FAIL] {failure}")
        print("manual_intervention_audit: FAIL")
        return 1
    print("manual_intervention_audit: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
