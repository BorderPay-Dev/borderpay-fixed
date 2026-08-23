#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock


AUDIT_PATH = Path(__file__).with_name("rc1_business_certification_gate_audit.py")
SPEC = importlib.util.spec_from_file_location("rc1_business_certification_gate_audit", AUDIT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load audit module from {AUDIT_PATH}")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class BusinessCertificationGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir=AUDIT.ROOT)
        self.original_artifact_root = AUDIT.ARTIFACT_ROOT
        AUDIT.ARTIFACT_ROOT = Path(self.temp_dir.name) / "business-certification"

    def tearDown(self) -> None:
        AUDIT.ARTIFACT_ROOT = self.original_artifact_root
        self.temp_dir.cleanup()

    @staticmethod
    def write_json(path: Path, value: dict) -> None:
        path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")

    def build_valid_bundle(self) -> None:
        root = AUDIT.ARTIFACT_ROOT
        root.mkdir(parents=True)
        captured_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        account_id = "business-certification-test-account"
        email = "business-certification@example.test"
        bridge_customer_id = "bridge-customer-test"
        capture_id = "capture-test-001"
        build_id = "build-test-001"
        attestation_id = "attestation-test-001"
        sha = "a" * 40

        self.write_json(root / "capture_context.json", {
            "capture_id": capture_id,
            "business_account_id": account_id,
            "rc1_git_commit": sha,
            "build_id": build_id,
            "build_artifact_sha256": "c" * 64,
            "deployment_attestation_id": attestation_id,
        })
        self.write_json(root / "provenance.json", {
            "account_email": email,
            "account_origin": {
                "source_table": "public.account_origin_provenance",
                "user_id": account_id,
                "account_type": "business",
                "origin_kind": "direct",
                "onboarding_channel": "direct",
                "source_path": "supabase/functions/auth-signup",
                "account_created_at": captured_at,
                "tenant_id": None,
                "api_key_id": None,
                "authorization_id": None,
                "external_user_id": None,
            },
            "manual_intervention_review": {
                "authority_status": "EXTERNAL_PROVIDER_AUDIT_EXPORT",
                "source": "supabase_postgres_pgaudit_export",
            },
        })

        window_start = captured_at
        window_end_dt = dt.datetime.strptime(captured_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc) + dt.timedelta(seconds=2)
        window_end = window_end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        audit_export = {
            "source": "supabase.logs.postgres",
            "project_ref": "orwrcpwsffjlvzuraxjc",
            "window_start": window_start,
            "window_end": window_end,
            "records": [
                {"timestamp": window_start, "user_name": "authenticator", "event_message": f"RC1_CERTIFICATION_AUDIT_START:{capture_id}"},
                {"timestamp": window_end, "user_name": "authenticator", "event_message": f"RC1_CERTIFICATION_AUDIT_END:{capture_id}"},
            ],
        }
        audit_raw = json.dumps(audit_export, sort_keys=True).encode("utf-8")
        (root / "manual-intervention-pgaudit-export.json").write_bytes(audit_raw)
        self.write_json(root / "manual_intervention_audit.json", {
            "authority_status": "EXTERNAL_PROVIDER_AUDIT_EXPORT",
            "source": "supabase_postgres_pgaudit_export",
            "project_ref": "orwrcpwsffjlvzuraxjc",
            "account_id": account_id,
            "capture_id": capture_id,
            "provider_export_id": "supabase-log-export-001",
            "provider_query_id": "supabase-log-query-001",
            "exported_by": "release-controller",
            "window_start": window_start,
            "window_end": window_end,
            "exported_at": window_end,
            "export_file": "manual-intervention-pgaudit-export.json",
            "export_sha256": hashlib.sha256(audit_raw).hexdigest(),
            "pgaudit_configuration": {
                "pgaudit.log": "write, ddl, role",
                "pgaudit.log_parameter": "on",
                "pgaudit.log_relation": "on",
                "shared_preload_libraries": "pg_stat_statements,pgaudit,plpgsql",
                "captured_at": window_start,
            },
        })

        performance_surfaces: dict[str, dict] = {}
        for surface in AUDIT.SURFACES:
            slug = str(surface["slug"])
            surface_dir = root / slug
            surface_dir.mkdir()
            png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 1, 1) + b"\x08\x06\x00\x00\x00" + b"\x00\x00\x00\x00"
            (surface_dir / "screenshot.png").write_bytes(png)
            resource_id = f"bridge-resource-{slug}"
            common = {"capture_id": capture_id, "account_id": account_id, "captured_at": captured_at}
            self.write_json(surface_dir / "api.json", {**common, "payload": {"state": "verified", "resource_id": resource_id}})
            self.write_json(surface_dir / "snapshot.json", {**common, "payload": {"state": "verified", "resource_id": resource_id}})
            self.write_json(
                surface_dir / "classification.json",
                {
                    **common,
                    "status": "PARTIALLY_LIVE",
                    "evidence_chain": {key: False for key in AUDIT.REQUIRED_CHAIN_KEYS},
                },
            )
            self.write_json(
                surface_dir / "screenshot_meta.json",
                {
                    **common,
                    "account_id": account_id,
                    "surface": slug,
                    "environment": "production",
                    "rc1_git_commit": sha,
                    "build_id": build_id,
                    "build_artifact_sha256": "c" * 64,
                    "deployment_attestation_id": attestation_id,
                },
            )
            self.write_json(
                surface_dir / "parity.json",
                {
                    **common,
                    "checks": [
                        {
                            "field": "state",
                            "match": True,
                            "api_value": "verified",
                            "snapshot_value": "verified",
                        }
                    ]
                },
            )
            if bool(surface["bridge_required"]):
                self.write_json(
                    surface_dir / "bridge.json",
                    {
                        **common,
                        "provider": "bridge",
                        "status": "active",
                        "resource_id": resource_id,
                    },
                )

            performance_surfaces[slug] = {
                metric: {"business": 100, "individual": 100}
                for metric in ("initial_render_ms", "time_to_data_ms", "loading_state_ms")
            }
            if slug in AUDIT.BUSINESS_ONLY_PERFORMANCE_SURFACES:
                for metric in ("initial_render_ms", "time_to_data_ms", "loading_state_ms"):
                    performance_surfaces[slug][metric].pop("individual")
                performance_surfaces[slug]["individual_comparison"] = {
                    "applicable": False,
                    "reason_code": AUDIT.NO_INDIVIDUAL_COMPARATOR_REASON,
                }

        self.write_json(root / "performance.json", {"surfaces": performance_surfaces})
        self.write_json(
            root / "onboarding.json",
            {
                "account_email": email,
                "account_type": "business",
                "created_via": "borderpay_signup",
                "email_verified": True,
                "business_verification_status": "approved",
                "bridge_customer_id": bridge_customer_id,
                "is_operator_account": False,
            },
        )
        self.write_json(
            root / AUDIT.MANIFEST_FILE,
            {
                "business_account_id": account_id,
                "business_email": email,
                "bridge_customer_id": bridge_customer_id,
                "kyb_status": "approved",
                "account_origin_kind": "direct",
                "onboarding_channel": "direct",
                "surfaces_passed": 0,
                "classification": "PARTIALLY_LIVE",
                "generated_at": captured_at,
                "evidence_hash": AUDIT.compute_evidence_hash(),
            },
        )

    def run_local_gate(self) -> tuple[int, str]:
        output = io.StringIO()
        with mock.patch.object(
            AUDIT,
            "verify_manifest_against_production",
            side_effect=AssertionError("local gate attempted production verification"),
        ), contextlib.redirect_stdout(output):
            result = AUDIT.run_certification()
        return result, output.getvalue()

    def test_missing_evidence_fails(self) -> None:
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("FAIL (missing local evidence)", output)

    def test_incomplete_evidence_fails(self) -> None:
        self.build_valid_bundle()
        (AUDIT.ARTIFACT_ROOT / "send" / "api.json").unlink()
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("missing required files ['api.json']", output)

    def test_malformed_evidence_fails(self) -> None:
        self.build_valid_bundle()
        (AUDIT.ARTIFACT_ROOT / "onboarding.json").write_text("{malformed", encoding="utf-8")
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("invalid json", output)

    def test_complete_surface_bundle_accepts_verified_manual_audit_authority(self) -> None:
        self.build_valid_bundle()
        result, output = self.run_local_gate()
        self.assertIn("independently retained audit export proves no observed privileged critical mutation", output)

    def test_privileged_critical_mutation_fails(self) -> None:
        self.build_valid_bundle()
        export_path = AUDIT.ARTIFACT_ROOT / "manual-intervention-pgaudit-export.json"
        export = json.loads(export_path.read_text(encoding="utf-8"))
        export["records"].insert(1, {
            "timestamp": export["window_start"],
            "user_name": "postgres",
            "event_message": "AUDIT: SESSION,WRITE,UPDATE,TABLE,public.user_profiles,UPDATE public.user_profiles SET account_type='business'",
        })
        raw = json.dumps(export, sort_keys=True).encode("utf-8")
        export_path.write_bytes(raw)
        metadata_path = AUDIT.ARTIFACT_ROOT / "manual_intervention_audit.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["export_sha256"] = hashlib.sha256(raw).hexdigest()
        self.write_json(metadata_path, metadata)
        manifest = json.loads((AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE).read_text(encoding="utf-8"))
        manifest["evidence_hash"] = AUDIT.compute_evidence_hash()
        self.write_json(AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE, manifest)
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("privileged certification-critical mutation", output)

    def test_manual_intervention_boolean_cannot_default_false(self) -> None:
        self.build_valid_bundle()
        provenance_path = AUDIT.ARTIFACT_ROOT / "provenance.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        provenance["manual_db_intervention"] = False
        self.write_json(provenance_path, provenance)
        manifest = json.loads((AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE).read_text(encoding="utf-8"))
        manifest["evidence_hash"] = AUDIT.compute_evidence_hash()
        self.write_json(AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE, manifest)
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("manual intervention cannot be represented by a Boolean default", output)

    def test_equivalent_surface_still_requires_individual_measurement(self) -> None:
        self.build_valid_bundle()
        performance = json.loads((AUDIT.ARTIFACT_ROOT / "performance.json").read_text(encoding="utf-8"))
        performance["surfaces"]["dashboard"]["initial_render_ms"].pop("individual")
        self.write_json(AUDIT.ARTIFACT_ROOT / "performance.json", performance)
        manifest = json.loads((AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE).read_text(encoding="utf-8"))
        manifest["evidence_hash"] = AUDIT.compute_evidence_hash()
        self.write_json(AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE, manifest)
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("Dashboard missing numeric initial_render_ms.individual", output)

    def test_business_only_surface_requires_audited_no_comparator_reason(self) -> None:
        self.build_valid_bundle()
        performance = json.loads((AUDIT.ARTIFACT_ROOT / "performance.json").read_text(encoding="utf-8"))
        performance["surfaces"]["treasury"].pop("individual_comparison")
        self.write_json(AUDIT.ARTIFACT_ROOT / "performance.json", performance)
        manifest = json.loads((AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE).read_text(encoding="utf-8"))
        manifest["evidence_hash"] = AUDIT.compute_evidence_hash()
        self.write_json(AUDIT.ARTIFACT_ROOT / AUDIT.MANIFEST_FILE, manifest)
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("Treasury must declare the audited non-applicable Individual comparator", output)

    def test_hash_mismatch_fails(self) -> None:
        self.build_valid_bundle()
        (AUDIT.ARTIFACT_ROOT / "dashboard" / "api.json").write_text(
            (AUDIT.ARTIFACT_ROOT / "dashboard" / "api.json").read_text(encoding="utf-8") + "\n",
            encoding="utf-8",
        )
        result, output = self.run_local_gate()
        self.assertNotEqual(result, 0)
        self.assertIn("evidence_hash mismatch", output)


if __name__ == "__main__":
    unittest.main()
