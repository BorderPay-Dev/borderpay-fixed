#!/usr/bin/env python3
"""Verify an externally retained, signed export of the certification audit chain."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


SOURCE = "borderpay_external_worm_audit_export_v1"
AUTHORITY_STATUS = "EXTERNAL_IMMUTABLE_AUDIT_EXPORT"
EXPORT_FILE = "manual-intervention-external-audit-export.json"
PUBLIC_KEY_FILE = "manual-intervention-sink-public-key.pem"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
PRIVILEGED_ACTORS = {"postgres", "supabase_admin", "dashboard_user", "supabase_read_only_user"}
CRITICAL_RELATIONS = {
    "auth.users", "public.user_profiles", "public.business_profiles",
    "public.account_origin_provenance", "public.operator_bridge_accounts",
    "public.bridge_wallets", "public.bridge_virtual_accounts",
    "public.bridge_external_accounts", "public.wallets", "public.transactions",
}


def _time(value: object) -> dt.datetime | None:
    if not isinstance(value, str) or not ISO_RE.fullmatch(value):
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _meaningful(value: object) -> bool:
    return isinstance(value, str) and len(value.strip()) >= 3 and not re.search(
        r"(?:placeholder|example|sample|mock|fake|todo|tbd|unknown)", value, re.I,
    )


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _verify_ed25519(public_key: Path, payload: bytes, signature_b64: object) -> bool:
    if not isinstance(signature_b64, str):
        return False
    try:
        signature = base64.b64decode(signature_b64, validate=True)
    except (ValueError, TypeError):
        return False
    with tempfile.TemporaryDirectory() as tmp:
        payload_path = Path(tmp) / "payload"
        signature_path = Path(tmp) / "signature"
        payload_path.write_bytes(payload)
        signature_path.write_bytes(signature)
        result = subprocess.run(
            ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(public_key),
             "-rawin", "-in", str(payload_path), "-sigfile", str(signature_path)],
            capture_output=True,
        )
    return result.returncode == 0


def validate_external_audit_ledger(
    root: Path,
    *,
    expected_account_id: str | None = None,
    expected_capture_id: str | None = None,
    trusted_public_key_sha256: str | None = None,
) -> list[str]:
    failures: list[str] = []
    metadata_path = root / "manual_intervention_audit.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ["missing manual-intervention audit file: manual_intervention_audit.json"]
    except json.JSONDecodeError as exc:
        return [f"malformed manual-intervention audit JSON manual_intervention_audit.json: {exc}"]
    if not isinstance(metadata, dict) or not metadata:
        return ["manual-intervention audit object must be non-empty"]
    if metadata.get("source") != SOURCE:
        failures.append(f"external audit source must be {SOURCE}")
    if metadata.get("authority_status") != AUTHORITY_STATUS:
        failures.append(f"external audit authority_status must be {AUTHORITY_STATUS}")
    for field in ("project_ref", "account_id", "capture_id", "provider", "provider_export_id", "exported_by", "sink_key_id"):
        if not _meaningful(metadata.get(field)):
            failures.append(f"external audit {field} must be non-placeholder")
    if expected_account_id is not None and metadata.get("account_id") != expected_account_id:
        failures.append("external audit account_id does not match certification account")
    if expected_capture_id is not None and metadata.get("capture_id") != expected_capture_id:
        failures.append("external audit capture_id does not match capture context")
    if metadata.get("export_file") != EXPORT_FILE:
        failures.append(f"external audit export_file must be {EXPORT_FILE}")

    window_start = _time(metadata.get("window_start"))
    window_end = _time(metadata.get("window_end"))
    exported_at = _time(metadata.get("exported_at"))
    if window_start is None or window_end is None or window_start >= window_end:
        failures.append("external audit requires an ordered ISO UTC capture window")
    if exported_at is None or (window_end is not None and exported_at < window_end):
        failures.append("external audit exported_at must be at or after window_end")
    if metadata.get("object_lock_mode") != "COMPLIANCE":
        failures.append("external audit requires COMPLIANCE object lock")
    retention_days = metadata.get("minimum_retention_days")
    if not isinstance(retention_days, int) or isinstance(retention_days, bool) or retention_days < 30:
        failures.append("external audit minimum_retention_days must be at least 30")

    key_path = root / PUBLIC_KEY_FILE
    try:
        key_raw = key_path.read_bytes()
    except FileNotFoundError:
        failures.append(f"missing external audit public key: {PUBLIC_KEY_FILE}")
        return failures
    key_hash = hashlib.sha256(key_raw).hexdigest()
    declared_key_hash = metadata.get("sink_public_key_sha256")
    trusted_hash = trusted_public_key_sha256 or os.environ.get("CERTIFICATION_AUDIT_SINK_PUBLIC_KEY_SHA256")
    if not isinstance(declared_key_hash, str) or not SHA256_RE.fullmatch(declared_key_hash) or declared_key_hash != key_hash:
        failures.append("external audit public key SHA-256 mismatch")
    if not isinstance(trusted_hash, str) or not SHA256_RE.fullmatch(trusted_hash):
        failures.append("trusted external audit public key fingerprint is not configured")
    elif trusted_hash != key_hash:
        failures.append("external audit public key is not the independently trusted key")

    export_path = root / EXPORT_FILE
    try:
        raw = export_path.read_bytes()
    except FileNotFoundError:
        failures.append(f"missing manual-intervention audit file: {EXPORT_FILE}")
        return failures
    export_hash = metadata.get("export_sha256")
    if not isinstance(export_hash, str) or not SHA256_RE.fullmatch(export_hash) or hashlib.sha256(raw).hexdigest() != export_hash:
        failures.append("external audit export SHA-256 mismatch")
    try:
        export = json.loads(raw)
    except json.JSONDecodeError as exc:
        failures.append(f"malformed external audit export JSON: {exc}")
        return failures
    if not isinstance(export, dict) or export.get("source") != "borderpay.external_worm_audit.v1":
        failures.append("external audit export source is invalid")
        return failures
    if export.get("project_ref") != metadata.get("project_ref"):
        failures.append("external audit export project_ref mismatch")
    if export.get("window_start") != metadata.get("window_start") or export.get("window_end") != metadata.get("window_end"):
        failures.append("external audit export window mismatch")
    records = export.get("records")
    if not isinstance(records, list) or not records:
        failures.append("external audit records must be a non-empty list")
        return failures

    prior_sequence = export.get("anchor_sequence")
    prior_hash = export.get("anchor_hash")
    if not isinstance(prior_sequence, int) or prior_sequence < 0 or not isinstance(prior_hash, str) or not SHA256_RE.fullmatch(prior_hash):
        failures.append("external audit anchor is invalid")
        return failures
    start_seen = end_seen = False
    capture_id = metadata.get("capture_id")
    account_id = metadata.get("account_id")
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            failures.append(f"external audit record {index} must be an object")
            continue
        sequence = record.get("sequence_no")
        if sequence != prior_sequence + 1:
            failures.append(f"external audit sequence gap at record {index}")
        if record.get("previous_hash") != prior_hash:
            failures.append(f"external audit previous hash mismatch at record {index}")
        payload = record.get("chain_payload")
        if not isinstance(payload, str) or not payload:
            failures.append(f"external audit chain payload missing at record {index}")
            continue
        calculated = hashlib.sha256((str(prior_hash) + payload).encode("utf-8")).hexdigest()
        if record.get("event_hash") != calculated:
            failures.append(f"external audit event hash mismatch at record {index}")
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            failures.append(f"external audit chain payload malformed at record {index}")
            continue
        for field in ("sequence_no", "event_id", "schema_name", "table_name", "operation", "record_key", "changed_fields", "actor", "old_values", "new_values"):
            if decoded.get(field) != record.get(field):
                failures.append(f"external audit payload mismatch for {field} at record {index}")
        occurred_at = _time(decoded.get("occurred_at"))
        if occurred_at is None or (window_start and window_end and not window_start <= occurred_at <= window_end):
            failures.append(f"external audit record {index} is outside the capture window")
        relation = f"{record.get('schema_name')}.{record.get('table_name')}"
        actor = record.get("actor") if isinstance(record.get("actor"), dict) else {}
        actor_names = {str(actor.get(key, "")).lower() for key in ("session_user", "current_user", "jwt_role")}
        if relation in CRITICAL_RELATIONS and record.get("operation") in {"INSERT", "UPDATE", "DELETE", "TRUNCATE"} and actor_names & PRIVILEGED_ACTORS:
            failures.append(f"external audit detected privileged certification-critical mutation in record {index}")
        values = record.get("new_values") if isinstance(record.get("new_values"), dict) else {}
        if relation == "certification.control" and values.get("capture_id") == capture_id and values.get("account_id") == account_id:
            start_seen = start_seen or values.get("marker_kind") == "START"
            end_seen = end_seen or values.get("marker_kind") == "END"

        receipt = record.get("receipt")
        if not isinstance(receipt, dict):
            failures.append(f"external audit signed receipt missing at record {index}")
        else:
            unsigned = {key: value for key, value in receipt.items() if key != "signature"}
            if receipt.get("event_id") != record.get("event_id") or receipt.get("sequence_no") != sequence or receipt.get("event_hash") != record.get("event_hash"):
                failures.append(f"external audit receipt correlation mismatch at record {index}")
            if receipt.get("key_id") != metadata.get("sink_key_id") or receipt.get("object_lock_mode") != "COMPLIANCE":
                failures.append(f"external audit receipt authority mismatch at record {index}")
            stored_at = _time(receipt.get("stored_at"))
            retention_until = _time(receipt.get("retention_until"))
            if stored_at is None or retention_until is None or retention_until < stored_at + dt.timedelta(days=30):
                failures.append(f"external audit receipt retention is insufficient at record {index}")
            if not _verify_ed25519(key_path, _canonical(unsigned), receipt.get("signature")):
                failures.append(f"external audit receipt signature invalid at record {index}")
        if isinstance(sequence, int):
            prior_sequence = sequence
        if isinstance(record.get("event_hash"), str):
            prior_hash = record["event_hash"]
    if not start_seen or not end_seen:
        failures.append("external audit export must contain correlated START and END markers")
    return failures
