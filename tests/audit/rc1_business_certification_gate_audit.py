#!/usr/bin/env python3
"""
RC1 business certification deployment gate.

This gate is intentionally evidence-driven and fail-closed:
- No artifact bundle => FAIL
- LIVE without full evidence chain => FAIL
- Performance thresholds breached => FAIL
- Certification account provenance invalid => FAIL
"""
from __future__ import annotations

import argparse
import json
import hashlib
import os
import re
import shlex
import subprocess
import sys
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_ROOT = ROOT / "artifacts" / "business-certification"
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
from validate_business_certification_bundle import validate_bundle  # noqa: E402
from verify_manual_intervention_audit import (  # noqa: E402
    AUTHORITY_STATUS as MANUAL_AUDIT_AUTHORITY_STATUS,
    SOURCE as MANUAL_AUDIT_SOURCE,
    validate_manual_intervention_audit,
)
from verify_external_audit_ledger import (  # noqa: E402
    AUTHORITY_STATUS as EXTERNAL_LEDGER_AUTHORITY_STATUS,
    SOURCE as EXTERNAL_LEDGER_SOURCE,
)

SURFACES: list[dict[str, object]] = [
    {"name": "Dashboard", "slug": "dashboard", "bridge_required": False},
    {"name": "Treasury", "slug": "treasury", "bridge_required": False},
    {"name": "Wallets", "slug": "wallets", "bridge_required": True},
    {"name": "Receive", "slug": "receive", "bridge_required": True},
    {"name": "Send", "slug": "send", "bridge_required": True},
    {"name": "Transactions", "slug": "transactions", "bridge_required": True},
    {"name": "Notifications", "slug": "notifications", "bridge_required": False},
    {"name": "Team", "slug": "team", "bridge_required": False},
    {"name": "Settings", "slug": "settings", "bridge_required": False},
    {"name": "External Accounts", "slug": "external-accounts", "bridge_required": True},
    {"name": "Business Profile", "slug": "business-profile", "bridge_required": False},
]

REQUIRED_SURFACE_FILES = ("screenshot.png", "api.json", "snapshot.json", "classification.json")
ALLOWED_STATUS = {"LIVE", "PARTIALLY_LIVE", "PLACEHOLDER"}
REQUIRED_CHAIN_KEYS = ("bridge", "backend", "ledger", "projection", "api", "ui")
FORBIDDEN_OVERRIDE_KEYS = {"manual_override", "override", "override_by", "override_reason", "approved_by"}

PERF_THRESHOLDS = {
    "initial_render_ms": 2000,
    "time_to_data_ms": 3000,
    "loading_state_ms": 5000,
    "slowdown_percent_max": 20.0,
}
MANIFEST_FILE = "certification_manifest.json"
MAX_MANIFEST_AGE_DAYS = 7

# These routes render a genuinely equivalent customer surface for both account
# types. Treasury exists only inside BusinessDashboard; Team renders a static
# business-only notice for Individuals; Business Profile performs business-only
# enrichment. Comparing those three to an Individual route would manufacture a
# baseline that the application does not actually provide.
INDIVIDUAL_COMPARABLE_SURFACES = {
    "dashboard", "wallets", "receive", "send", "transactions",
    "notifications", "settings", "external-accounts",
}
BUSINESS_ONLY_PERFORMANCE_SURFACES = {"treasury", "team", "business-profile"}
NO_INDIVIDUAL_COMPARATOR_REASON = "NO_EQUIVALENT_INDIVIDUAL_SURFACE"

ISO_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

LIVE_EXECUTION_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "send": (
        "transfer_created",
        "provider_accepted",
        "ledger_updated",
        "transaction_visible",
        "ui_reflects_result",
    ),
    "receive": (
        "receive_rail_active",
        "deposit_received",
        "ledger_updated",
        "transaction_visible",
        "balance_updated",
    ),
    "transactions": (
        "provider_event_ingested",
        "ledger_updated",
        "transaction_visible",
        "ui_reflects_result",
    ),
    "wallets": (
        "wallet_loaded",
        "ledger_updated",
        "projection_updated",
        "api_snapshot_parity",
        "ui_reflects_result",
    ),
    "external-accounts": (
        "external_account_linked",
        "provider_status_active",
        "api_snapshot_parity",
        "ui_reflects_result",
    ),
}


def fail(msg: str, failures: list[str]) -> None:
    print(f"[FAIL] {msg}")
    failures.append(msg)


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def read_json(path: Path) -> tuple[dict, str | None]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}, f"missing file: {path.relative_to(ROOT)}"
    except json.JSONDecodeError as exc:
        return {}, f"invalid json ({path.relative_to(ROOT)}): {exc}"
    if not isinstance(value, dict):
        return {}, f"json root must be an object: {path.relative_to(ROOT)}"
    return value, None


def run_shell(cmd: str) -> tuple[int, str, str]:
    p = subprocess.run(
        ["/bin/zsh", "-lc", f"cd {shlex.quote(str(ROOT))} && {cmd}"],
        text=True,
        capture_output=True,
    )
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def parse_iso_utc(value: str) -> dt.datetime | None:
    if not ISO_UTC_RE.match(value):
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def verify_manifest_against_production(manifest: dict) -> tuple[bool, str]:
    """
    Verify manifest identity tuple against production data.

    Requires Supabase CLI linked context and network access in CI/runtime.
    Fail-closed when unavailable.
    """
    required = (
        "business_account_id", "business_email", "bridge_customer_id", "kyb_status",
        "account_origin_kind", "onboarding_channel",
    )
    missing = [k for k in required if not manifest.get(k)]
    if missing:
        return False, f"manifest missing fields for production verification: {missing}"

    business_id = str(manifest["business_account_id"]).strip()
    business_email = str(manifest["business_email"]).strip().lower()
    bridge_customer_id = str(manifest["bridge_customer_id"]).strip()
    kyb_status = str(manifest["kyb_status"]).strip().lower()
    approved_statuses = {"approved", "kyb_approved", "business_verification_approved"}
    if kyb_status not in approved_statuses:
        return False, "manifest kyb_status is not approved"

    # CI/linked environments should provide this; keep fail-closed if missing.
    if not os.environ.get("SUPABASE_ACCESS_TOKEN") and not os.environ.get("SUPABASE_DB_PASSWORD"):
        return False, "missing Supabase credentials/environment for production verification"

    sql = (
        "select "
        "bp.user_id::text as business_account_id, "
        "lower(coalesce(up.email,'')) as business_email, "
        "coalesce(bp.bridge_customer_id,'') as bridge_customer_id, "
        "lower(coalesce(bp.bridge_kyb_status,'')) as kyb_status "
        ",coalesce(aop.origin_kind,'') as account_origin_kind "
        ",coalesce(aop.onboarding_channel,'') as onboarding_channel "
        ",coalesce(aop.source_path,'') as origin_source_path "
        "from public.business_profiles bp "
        "left join public.user_profiles up on up.id = bp.user_id "
        "left join public.account_origin_provenance aop on aop.user_id = bp.user_id "
        f"where bp.user_id = '{business_id}' "
        "limit 1;"
    )
    cmd = f"SUPABASE_DISABLE_TELEMETRY=1 supabase db query --linked -o json {shlex.quote(sql)}"
    rc, out, err = run_shell(cmd)
    if rc != 0:
        return False, f"production verification query failed: {err or out or f'exit={rc}'}"
    try:
        rows = json.loads(out)
    except Exception:
        return False, "production verification query returned non-JSON output"
    if not isinstance(rows, list) or not rows:
        return False, "production verification found no matching business profile row"
    row = rows[0] if isinstance(rows[0], dict) else {}
    if str(row.get("business_account_id", "")).strip() != business_id:
        return False, "production mismatch: business_account_id"
    if str(row.get("business_email", "")).strip().lower() != business_email:
        return False, "production mismatch: business_email"
    if str(row.get("bridge_customer_id", "")).strip() != bridge_customer_id:
        return False, "production mismatch: bridge_customer_id"
    if str(row.get("kyb_status", "")).strip().lower() not in approved_statuses:
        return False, "production mismatch: kyb_status not approved"
    if str(row.get("account_origin_kind", "")).strip() != "direct":
        return False, "production mismatch: account origin is not direct"
    if str(row.get("onboarding_channel", "")).strip() != "direct":
        return False, "production mismatch: onboarding channel is not direct"
    if str(row.get("origin_source_path", "")).strip() != "supabase/functions/auth-signup":
        return False, "production mismatch: origin source path is not auth-signup"
    return True, "production account tuple verified"


def as_number(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def maybe_account_id(value: object) -> bool:
    return isinstance(value, str) and bool(str(value).strip())


def compute_evidence_hash() -> str:
    """
    Stable hash over RC1 evidence artifacts.
    Excludes the manifest itself, README, and .gitkeep markers.
    """
    files: list[Path] = []
    for p in ARTIFACT_ROOT.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(ARTIFACT_ROOT)
        if rel.name in {MANIFEST_FILE, "README.md", ".gitkeep"}:
            continue
        files.append(p)
    files.sort(key=lambda x: str(x.relative_to(ARTIFACT_ROOT)))

    digest = hashlib.sha256()
    for p in files:
        rel = str(p.relative_to(ARTIFACT_ROOT)).replace("\\", "/")
        digest.update(rel.encode("utf-8"))
        digest.update(b"\x00")
        digest.update(p.read_bytes())
        digest.update(b"\x00")
    return digest.hexdigest()


def validate_surface_artifacts(failures: list[str]) -> None:
    for surface in SURFACES:
        name = str(surface["name"])
        slug = str(surface["slug"])
        bridge_required = bool(surface["bridge_required"])
        surface_dir = ARTIFACT_ROOT / slug

        if not surface_dir.is_dir():
            fail(f"{name}: missing surface directory {surface_dir.relative_to(ROOT)}", failures)
            continue
        ok(f"{name}: surface directory present")

        missing = [f for f in REQUIRED_SURFACE_FILES if not (surface_dir / f).is_file()]
        if missing:
            fail(f"{name}: missing required files {missing}", failures)
            continue
        if not (surface_dir / "screenshot_meta.json").is_file():
            fail(f"{name}: missing required file screenshot_meta.json", failures)
        if not (surface_dir / "parity.json").is_file():
            fail(f"{name}: missing required file parity.json", failures)

        shot_meta, shot_err = read_json(surface_dir / "screenshot_meta.json")
        if shot_err:
            fail(f"{name}: {shot_err}", failures)
        else:
            captured_at = shot_meta.get("captured_at")
            if not isinstance(captured_at, str) or not ISO_UTC_RE.match(captured_at):
                fail(f"{name}: screenshot_meta.captured_at must be ISO UTC timestamp", failures)
            if not maybe_account_id(shot_meta.get("account_id")):
                fail(f"{name}: screenshot_meta.account_id must be non-empty", failures)
            if shot_meta.get("surface") != slug:
                fail(f"{name}: screenshot_meta.surface must equal '{slug}'", failures)
            if shot_meta.get("environment") != "production":
                fail(f"{name}: screenshot_meta.environment must be 'production'", failures)

        parity, parity_err = read_json(surface_dir / "parity.json")
        if parity_err:
            fail(f"{name}: {parity_err}", failures)
        else:
            checks = parity.get("checks")
            if not isinstance(checks, list) or not checks:
                fail(f"{name}: parity.json must include non-empty checks[]", failures)
            else:
                for idx, check in enumerate(checks):
                    if not isinstance(check, dict):
                        fail(f"{name}: parity.checks[{idx}] must be object", failures)
                        continue
                    if check.get("match") is not True:
                        fail(f"{name}: parity.checks[{idx}].match must be true", failures)
                    if "api_value" not in check or "snapshot_value" not in check:
                        fail(f"{name}: parity.checks[{idx}] missing api_value/snapshot_value", failures)
                    elif check.get("api_value") != check.get("snapshot_value"):
                        fail(
                            f"{name}: parity.checks[{idx}] api_value != snapshot_value",
                            failures,
                        )

        cls_path = surface_dir / "classification.json"
        cls, cls_err = read_json(cls_path)
        if cls_err:
            fail(f"{name}: {cls_err}", failures)
            continue

        forbidden = sorted(FORBIDDEN_OVERRIDE_KEYS.intersection(cls.keys()))
        if forbidden:
            fail(f"{name}: forbidden manual override keys present: {forbidden}", failures)

        status = cls.get("status")
        if status not in ALLOWED_STATUS:
            fail(f"{name}: status must be one of {sorted(ALLOWED_STATUS)}", failures)
            continue
        ok(f"{name}: classification status={status}")

        chain = cls.get("evidence_chain")
        if not isinstance(chain, dict):
            fail(f"{name}: evidence_chain object missing", failures)
            continue

        missing_keys = [k for k in REQUIRED_CHAIN_KEYS if k not in chain]
        if missing_keys:
            fail(f"{name}: evidence_chain missing keys {missing_keys}", failures)
            continue

        non_bool = [k for k in REQUIRED_CHAIN_KEYS if not isinstance(chain.get(k), bool)]
        if non_bool:
            fail(f"{name}: evidence_chain keys must be booleans {non_bool}", failures)
            continue

        if bridge_required and not (surface_dir / "bridge.json").is_file():
            fail(f"{name}: bridge.json required for Bridge-backed surface", failures)
        if bridge_required and (surface_dir / "bridge.json").is_file():
            bridge_data, bridge_err = read_json(surface_dir / "bridge.json")
            if bridge_err:
                fail(f"{name}: {bridge_err}", failures)
            else:
                if bridge_data.get("provider") != "bridge":
                    fail(f"{name}: bridge.json.provider must be 'bridge'", failures)
                if not maybe_account_id(bridge_data.get("status")):
                    fail(f"{name}: bridge.json.status must be non-empty", failures)
                has_identifier = any(
                    maybe_account_id(bridge_data.get(k))
                    for k in (
                        "resource_id",
                        "transfer_id",
                        "wallet_id",
                        "external_account_id",
                        "virtual_account_id",
                    )
                )
                if not has_identifier:
                    fail(
                        f"{name}: bridge.json must include one provider resource identifier",
                        failures,
                    )

        if status == "LIVE":
            false_links = [k for k in REQUIRED_CHAIN_KEYS if chain.get(k) is not True]
            if false_links:
                fail(f"{name}: LIVE requires full evidence chain, false links={false_links}", failures)
            if bridge_required and chain.get("bridge") is not True:
                fail(f"{name}: LIVE requires bridge=true for Bridge-backed surface", failures)
            if bridge_required:
                bridge_data, bridge_err = read_json(surface_dir / "bridge.json")
                if bridge_err:
                    fail(f"{name}: {bridge_err}", failures)
                elif not bridge_data:
                    fail(f"{name}: bridge.json must be non-empty for LIVE classification", failures)
            execution = cls.get("execution")
            if not isinstance(execution, dict):
                fail(f"{name}: LIVE requires execution object in classification.json", failures)
            else:
                required_steps = LIVE_EXECUTION_REQUIREMENTS.get(slug)
                if required_steps:
                    missing_or_false = [k for k in required_steps if execution.get(k) is not True]
                    if missing_or_false:
                        fail(
                            f"{name}: LIVE execution steps missing/false={missing_or_false}",
                            failures,
                        )


def metric_pair(entry: dict, metric_name: str) -> tuple[float | None, float | None]:
    metric = entry.get(metric_name)
    if not isinstance(metric, dict):
        return None, None
    return as_number(metric.get("business")), as_number(metric.get("individual"))


def validate_performance_gate(failures: list[str]) -> None:
    perf_path = ARTIFACT_ROOT / "performance.json"
    perf, err = read_json(perf_path)
    if err:
        fail(f"performance gate: {err}", failures)
        return

    surfaces = perf.get("surfaces")
    if not isinstance(surfaces, dict):
        fail("performance gate: surfaces object missing", failures)
        return

    for surface in SURFACES:
        name = str(surface["name"])
        slug = str(surface["slug"])
        entry = surfaces.get(slug)
        if not isinstance(entry, dict):
            fail(f"performance gate: missing surface metrics for {name} ({slug})", failures)
            continue

        business_initial, individual_initial = metric_pair(entry, "initial_render_ms")
        business_ttd, individual_ttd = metric_pair(entry, "time_to_data_ms")
        business_loading, individual_loading = metric_pair(entry, "loading_state_ms")

        comparable = slug in INDIVIDUAL_COMPARABLE_SURFACES
        if slug in BUSINESS_ONLY_PERFORMANCE_SURFACES:
            comparison = entry.get("individual_comparison")
            if not isinstance(comparison, dict) or comparison.get("applicable") is not False or comparison.get("reason_code") != NO_INDIVIDUAL_COMPARATOR_REASON:
                fail(
                    f"performance gate: {name} must declare the audited non-applicable Individual comparator",
                    failures,
                )

        for metric_name, business_v, individual_v, limit in [
            ("initial_render_ms", business_initial, individual_initial, PERF_THRESHOLDS["initial_render_ms"]),
            ("time_to_data_ms", business_ttd, individual_ttd, PERF_THRESHOLDS["time_to_data_ms"]),
            ("loading_state_ms", business_loading, individual_loading, PERF_THRESHOLDS["loading_state_ms"]),
        ]:
            if business_v is None:
                fail(f"performance gate: {name} missing numeric {metric_name}.business", failures)
                continue
            if business_v > float(limit):
                fail(
                    f"performance gate: {name} {metric_name}.business={business_v:.0f} exceeds {int(limit)}ms",
                    failures,
                )
            if comparable:
                if individual_v is None:
                    fail(f"performance gate: {name} missing numeric {metric_name}.individual", failures)
                    continue
                slowdown = ((business_v - individual_v) / max(individual_v, 1.0)) * 100.0
                if slowdown > float(PERF_THRESHOLDS["slowdown_percent_max"]):
                    fail(
                        f"performance gate: {name} {metric_name} slowdown={slowdown:.2f}% exceeds {PERF_THRESHOLDS['slowdown_percent_max']}%",
                        failures,
                    )
        ok(f"performance gate: metrics parsed for {name}")


def validate_onboarding_gate(failures: list[str]) -> None:
    onboarding_path = ARTIFACT_ROOT / "onboarding.json"
    data, err = read_json(onboarding_path)
    if err:
        fail(f"onboarding gate: {err}", failures)
        return

    required_fields = [
        "account_email",
        "account_type",
        "created_via",
        "email_verified",
        "business_verification_status",
        "bridge_customer_id",
        "is_operator_account",
    ]
    missing_fields = [f for f in required_fields if f not in data]
    if missing_fields:
        fail(f"onboarding gate: missing fields {missing_fields}", failures)
        return

    if data.get("account_type") != "business":
        fail("onboarding gate: account_type must be business", failures)
    if data.get("created_via") != "borderpay_signup":
        fail("onboarding gate: created_via must be borderpay_signup", failures)
    if data.get("email_verified") is not True:
        fail("onboarding gate: email_verified must be true", failures)

    verification_status = str(data.get("business_verification_status", "")).lower()
    if verification_status not in {"approved", "kyb_approved", "business_verification_approved"}:
        fail("onboarding gate: business_verification_status must be approved", failures)

    bridge_customer_id = str(data.get("bridge_customer_id", "")).strip()
    if not bridge_customer_id:
        fail("onboarding gate: bridge_customer_id must be present", failures)

    for field in ("is_operator_account",):
        if not isinstance(data.get(field), bool):
            fail(f"onboarding gate: {field} must be boolean", failures)

    if data.get("is_operator_account") is True:
        fail("onboarding gate: operator accounts are invalid for certification", failures)
    ok("onboarding gate: certification account provenance validated")


def validate_authoritative_provenance(failures: list[str]) -> None:
    data, err = read_json(ARTIFACT_ROOT / "provenance.json")
    if err:
        fail(f"provenance gate: {err}", failures)
        return
    origin = data.get("account_origin")
    if not isinstance(origin, dict):
        fail("provenance gate: account_origin object is required", failures)
        return
    expected = {
        "source_table": "public.account_origin_provenance",
        "account_type": "business",
        "origin_kind": "direct",
        "onboarding_channel": "direct",
        "source_path": "supabase/functions/auth-signup",
    }
    for key, value in expected.items():
        if origin.get(key) != value:
            fail(f"provenance gate: account_origin.{key} must equal {value}", failures)
    if not maybe_account_id(origin.get("user_id")):
        fail("provenance gate: account_origin.user_id is required", failures)
    if not isinstance(origin.get("account_created_at"), str) or parse_iso_utc(origin.get("account_created_at")) is None:
        fail("provenance gate: account_origin.account_created_at must be ISO UTC", failures)
    if any(origin.get(key) is not None for key in ("tenant_id", "api_key_id", "authorization_id", "external_user_id")):
        fail("provenance gate: direct origin cannot contain partner context", failures)

    onboarding, onboarding_err = read_json(ARTIFACT_ROOT / "onboarding.json")
    manifest, manifest_err = read_json(ARTIFACT_ROOT / MANIFEST_FILE)
    if not onboarding_err and str(onboarding.get("account_email", "")).strip().lower() != str(data.get("account_email", "")).strip().lower():
        fail("provenance gate: account email mismatch", failures)
    if not manifest_err and str(origin.get("user_id", "")).strip() != str(manifest.get("business_account_id", "")).strip():
        fail("provenance gate: origin user_id must match manifest business_account_id", failures)

    manual = data.get("manual_intervention_review")
    if not isinstance(manual, dict):
        fail("provenance gate: manual_intervention_review object is required", failures)
        return
    supported_manual_sources = {
        MANUAL_AUDIT_SOURCE: MANUAL_AUDIT_AUTHORITY_STATUS,
        EXTERNAL_LEDGER_SOURCE: EXTERNAL_LEDGER_AUTHORITY_STATUS,
    }
    manual_source = manual.get("source")
    if manual_source not in supported_manual_sources:
        fail("provenance gate: manual audit source is unsupported", failures)
    elif manual.get("authority_status") != supported_manual_sources[manual_source]:
        fail(f"provenance gate: manual authority_status must be {supported_manual_sources[manual_source]}", failures)
    capture_context, context_err = read_json(ARTIFACT_ROOT / "capture_context.json")
    expected_account_id = str(origin.get("user_id", "")).strip()
    expected_capture_id = None if context_err else str(capture_context.get("capture_id", "")).strip()
    manual_failures = validate_manual_intervention_audit(
        ARTIFACT_ROOT,
        expected_account_id=expected_account_id or None,
        expected_capture_id=expected_capture_id or None,
    )
    for message in manual_failures:
        fail(f"provenance gate: {message}", failures)
    if not manual_failures:
        ok("provenance gate: independently retained audit export proves no observed privileged critical mutation in capture window")


def validate_certification_manifest(
    failures: list[str],
    statuses: dict[str, str],
    *,
    verify_production: bool,
) -> None:
    manifest_path = ARTIFACT_ROOT / MANIFEST_FILE
    data, err = read_json(manifest_path)
    if err:
        fail(f"manifest gate: {err}", failures)
        return

    local_failures = 0

    def local_fail(message: str) -> None:
        nonlocal local_failures
        local_failures += 1
        fail(message, failures)

    required_fields = [
        "business_account_id",
        "business_email",
        "bridge_customer_id",
        "kyb_status",
        "account_origin_kind",
        "onboarding_channel",
        "surfaces_passed",
        "classification",
        "generated_at",
        "evidence_hash",
    ]
    missing = [f for f in required_fields if f not in data]
    if missing:
        local_fail(f"manifest gate: missing fields {missing}")
        return

    if not maybe_account_id(data.get("business_account_id")):
        local_fail("manifest gate: business_account_id must be non-empty")
    email = str(data.get("business_email", "")).strip()
    if not email or "@" not in email:
        local_fail("manifest gate: business_email must be non-empty valid email")
    if not maybe_account_id(data.get("bridge_customer_id")):
        local_fail("manifest gate: bridge_customer_id must be non-empty")

    kyb_status = str(data.get("kyb_status", "")).lower()
    if kyb_status not in {"approved", "kyb_approved", "business_verification_approved"}:
        local_fail("manifest gate: kyb_status must be approved")

    if not isinstance(data.get("surfaces_passed"), int):
        local_fail("manifest gate: surfaces_passed must be integer")
    if data.get("classification") not in ALLOWED_STATUS:
        local_fail(f"manifest gate: classification must be one of {sorted(ALLOWED_STATUS)}")

    generated_at = data.get("generated_at")
    if not isinstance(generated_at, str) or not ISO_UTC_RE.match(generated_at):
        local_fail("manifest gate: generated_at must be ISO UTC timestamp")
    else:
        parsed = parse_iso_utc(generated_at)
        if parsed is None:
            local_fail("manifest gate: generated_at parse failure")
        else:
            age = dt.datetime.now(dt.timezone.utc) - parsed
            if age.total_seconds() < 0:
                local_fail("manifest gate: generated_at cannot be in the future")
            elif age > dt.timedelta(days=MAX_MANIFEST_AGE_DAYS):
                local_fail(
                    f"manifest gate: evidence is stale; generated_at older than {MAX_MANIFEST_AGE_DAYS} days"
                )

    computed_hash = compute_evidence_hash()
    manifest_hash = str(data.get("evidence_hash", "")).strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", manifest_hash):
        local_fail("manifest gate: evidence_hash must be a sha256 hex string")
    elif manifest_hash != computed_hash:
        local_fail("manifest gate: evidence_hash mismatch vs artifact bundle")

    live_count = sum(1 for v in statuses.values() if v == "LIVE")
    if isinstance(data.get("surfaces_passed"), int) and data.get("surfaces_passed") != live_count:
        local_fail(
            f"manifest gate: surfaces_passed={data.get('surfaces_passed')} does not equal LIVE surface count={live_count}",
        )

    # Cross-file binding first.
    onboarding, onboarding_err = read_json(ARTIFACT_ROOT / "onboarding.json")
    if onboarding_err:
        local_fail("manifest gate: onboarding.json required for manifest account binding")
    else:
        if str(onboarding.get("account_email", "")).strip().lower() != str(data.get("business_email", "")).strip().lower():
            local_fail("manifest gate: business_email must match onboarding.account_email")
        if str(onboarding.get("bridge_customer_id", "")).strip() != str(data.get("bridge_customer_id", "")).strip():
            local_fail("manifest gate: bridge_customer_id must match onboarding.bridge_customer_id")
        on_status = str(onboarding.get("business_verification_status", "")).strip().lower()
        if on_status not in {"approved", "kyb_approved", "business_verification_approved"}:
            local_fail("manifest gate: onboarding business_verification_status must be approved")

    # Production tuple verification is a separate, explicitly authorized gate.
    # The local/static certification audit must never initiate linked production access.
    if verify_production:
        prod_ok, prod_msg = verify_manifest_against_production(data)
        if not prod_ok:
            local_fail(f"manifest gate: production verification failed ({prod_msg})")
        else:
            ok(f"manifest gate: {prod_msg}")
    else:
        print(
            "[INFO] manifest gate: production account-tuple verification was not run; "
            "it requires separate explicit authorization"
        )

    if local_failures == 0:
        ok("manifest gate: certification manifest and evidence hash validated")


def run_certification(*, verify_production: bool = False) -> int:
    failures: list[str] = []
    statuses: dict[str, str] = {}

    if not ARTIFACT_ROOT.is_dir():
        fail(f"missing artifact root: {ARTIFACT_ROOT.relative_to(ROOT)}", failures)
        print("\nrc1_business_certification_gate_audit: FAIL (missing local evidence)")
        return 1

    for strict_failure in validate_bundle(ARTIFACT_ROOT):
        fail(f"strict evidence contract: {strict_failure}", failures)

    validate_surface_artifacts(failures)
    # Re-read statuses from classification files for manifest consistency.
    for surface in SURFACES:
        slug = str(surface["slug"])
        cls_path = ARTIFACT_ROOT / slug / "classification.json"
        cls, _ = read_json(cls_path)
        status = cls.get("status")
        if isinstance(status, str):
            statuses[slug] = status
    validate_performance_gate(failures)
    validate_onboarding_gate(failures)
    validate_authoritative_provenance(failures)
    validate_certification_manifest(
        failures,
        statuses,
        verify_production=verify_production,
    )

    if failures:
        print(f"\nrc1_business_certification_gate_audit: FAIL ({len(failures)} checks)")
        return 1

    print("\nrc1_business_certification_gate_audit: PASS")
    print(" - Required evidence artifacts exist for all business surfaces")
    print(" - LIVE classifications are strictly evidence-backed")
    print(" - Performance thresholds and onboarding provenance are satisfied")
    if verify_production:
        print(" - Production account tuple was explicitly verified")
    else:
        print(" - Production account-tuple verification remains separately required")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-production",
        action="store_true",
        help=(
            "explicitly verify the manifest account tuple against linked production; "
            "requires separate authorization and production credentials"
        ),
    )
    args = parser.parse_args()
    return run_certification(verify_production=args.verify_production)


if __name__ == "__main__":
    sys.exit(main())
