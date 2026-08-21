#!/usr/bin/env python3
"""Strict offline schema/correlation validator for RC1 certification evidence."""
from __future__ import annotations

import datetime as dt
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_manual_intervention_audit import validate_manual_intervention_audit  # noqa: E402


SURFACES = (
    "dashboard", "treasury", "wallets", "receive", "send", "transactions",
    "notifications", "team", "settings", "external-accounts", "business-profile",
)
BRIDGE_SURFACES = {"wallets", "receive", "send", "transactions", "external-accounts"}
ALLOWED_STATUS = {"LIVE", "PARTIALLY_LIVE", "PLACEHOLDER"}
IDENTIFIER_KEYS = ("resource_id", "transfer_id", "wallet_id", "external_account_id", "virtual_account_id")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PLACEHOLDER_RE = re.compile(r"^(?:placeholder|example|sample|mock|fake|todo|tbd|unknown|null|n/?a)(?:[-_\s].*)?$", re.I)


def _read_object(path: Path, failures: list[str]) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        failures.append(f"missing file: {path}")
        return None
    except json.JSONDecodeError as exc:
        failures.append(f"malformed JSON {path}: {exc}")
        return None
    if not isinstance(value, dict) or not value:
        failures.append(f"JSON object must be non-empty: {path}")
        return None
    return value


def _meaningful(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not PLACEHOLDER_RE.fullmatch(value.strip())


def _valid_time(value: object) -> bool:
    if not isinstance(value, str) or not ISO_RE.fullmatch(value):
        return False
    try:
        dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
        return True
    except ValueError:
        return False


def _png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return None
    if len(raw) < 33 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", raw[16:24])
    return (width, height) if width > 0 and height > 0 else None


def validate_bundle(root: Path) -> list[str]:
    failures: list[str] = []
    context = _read_object(root / "capture_context.json", failures)
    if context is None:
        return failures
    provenance = _read_object(root / "provenance.json", failures)
    if provenance is not None:
        origin = provenance.get("account_origin")
        if not isinstance(origin, dict) or not origin:
            failures.append("provenance.account_origin must be a non-empty captured object")
        elif origin.get("source_table") != "public.account_origin_provenance":
            failures.append("provenance.account_origin must reference public.account_origin_provenance")
        if isinstance(provenance.get("manual_db_intervention"), bool):
            failures.append("manual intervention cannot be represented by a Boolean default")

    capture_id = context.get("capture_id")
    account_id = context.get("business_account_id")
    rc1_sha = context.get("rc1_git_commit")
    build_id = context.get("build_id")
    build_artifact_sha256 = context.get("build_artifact_sha256")
    attestation_id = context.get("deployment_attestation_id")
    for name, value in (
        ("capture_id", capture_id), ("business_account_id", account_id),
        ("build_id", build_id), ("deployment_attestation_id", attestation_id),
    ):
        if not _meaningful(value):
            failures.append(f"capture_context.{name} must be non-placeholder")
    if not isinstance(rc1_sha, str) or not SHA_RE.fullmatch(rc1_sha):
        failures.append("capture_context.rc1_git_commit must be a lowercase 40-character SHA")
    if not isinstance(build_artifact_sha256, str) or not SHA256_RE.fullmatch(build_artifact_sha256):
        failures.append("capture_context.build_artifact_sha256 must be a SHA-256 digest")

    failures.extend(validate_manual_intervention_audit(
        root,
        expected_account_id=account_id if isinstance(account_id, str) else None,
        expected_capture_id=capture_id if isinstance(capture_id, str) else None,
    ))

    for slug in SURFACES:
        surface = root / slug
        if not surface.is_dir():
            failures.append(f"missing surface directory: {slug}")
            continue
        api = _read_object(surface / "api.json", failures)
        snapshot = _read_object(surface / "snapshot.json", failures)
        meta = _read_object(surface / "screenshot_meta.json", failures)
        parity = _read_object(surface / "parity.json", failures)
        classification = _read_object(surface / "classification.json", failures)
        if _png_dimensions(surface / "screenshot.png") is None:
            failures.append(f"{slug}: screenshot.png must be a non-empty PNG with a valid IHDR")
        objects = {
            "api": api, "snapshot": snapshot, "screenshot_meta": meta,
            "parity": parity, "classification": classification,
        }
        for name, obj in objects.items():
            if obj is None:
                continue
            if obj.get("capture_id") != capture_id:
                failures.append(f"{slug}: {name}.capture_id mismatch")
            if obj.get("account_id") != account_id:
                failures.append(f"{slug}: {name}.account_id mismatch")
            if not _valid_time(obj.get("captured_at")):
                failures.append(f"{slug}: {name}.captured_at must be ISO UTC")
        timestamps = {obj.get("captured_at") for obj in objects.values() if obj is not None}
        if len(timestamps) > 1:
            failures.append(f"{slug}: evidence timestamps do not identify one execution")

        if api is not None and (not isinstance(api.get("payload"), dict) or not api.get("payload")):
            failures.append(f"{slug}: api.payload must be a non-empty captured object")
        if snapshot is not None and (not isinstance(snapshot.get("payload"), dict) or not snapshot.get("payload")):
            failures.append(f"{slug}: snapshot.payload must be a non-empty captured object")
        if meta is not None:
            if meta.get("surface") != slug or meta.get("environment") != "production":
                failures.append(f"{slug}: screenshot metadata surface/environment mismatch")
            for field, expected in (
                ("rc1_git_commit", rc1_sha), ("build_id", build_id),
                ("build_artifact_sha256", build_artifact_sha256),
                ("deployment_attestation_id", attestation_id),
            ):
                if meta.get(field) != expected:
                    failures.append(f"{slug}: screenshot_meta.{field} mismatch")
        if classification is not None and classification.get("status") not in ALLOWED_STATUS:
            failures.append(f"{slug}: invalid classification")
        if parity is not None:
            checks = parity.get("checks")
            if not isinstance(checks, list) or not checks:
                failures.append(f"{slug}: parity checks must be non-empty")
            else:
                for idx, check in enumerate(checks):
                    if not isinstance(check, dict) or not _meaningful(check.get("field")):
                        failures.append(f"{slug}: parity check {idx} needs a non-placeholder field")
                        continue
                    if check.get("match") is not True or check.get("api_value") != check.get("snapshot_value"):
                        failures.append(f"{slug}: parity check {idx} does not match")

        if slug in BRIDGE_SURFACES:
            bridge = _read_object(surface / "bridge.json", failures)
            if bridge is None:
                continue
            if bridge.get("capture_id") != capture_id or bridge.get("account_id") != account_id:
                failures.append(f"{slug}: bridge correlation mismatch")
            if not _valid_time(bridge.get("captured_at")) or (timestamps and bridge.get("captured_at") not in timestamps):
                failures.append(f"{slug}: bridge timestamp mismatch")
            identifiers = [str(bridge[k]).strip() for k in IDENTIFIER_KEYS if _meaningful(bridge.get(k))]
            if len(identifiers) != 1:
                failures.append(f"{slug}: bridge evidence must contain exactly one canonical resource identifier")
            elif api is not None and snapshot is not None:
                identifier = identifiers[0]
                if identifier not in json.dumps(api, sort_keys=True):
                    failures.append(f"{slug}: Bridge resource ID missing from api.json")
                if identifier not in json.dumps(snapshot, sort_keys=True):
                    failures.append(f"{slug}: Bridge resource ID missing from snapshot.json")

    return failures
