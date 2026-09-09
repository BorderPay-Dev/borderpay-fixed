#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import datetime as dt
import importlib.util
import io
import json
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

        performance_surfaces: dict[str, dict] = {}
        for surface in AUDIT.SURFACES:
            slug = str(surface["slug"])
            surface_dir = root / slug
            surface_dir.mkdir()
            (surface_dir / "screenshot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
            self.write_json(surface_dir / "api.json", {"state": "verified"})
            self.write_json(surface_dir / "snapshot.json", {"state": "verified"})
            self.write_json(
                surface_dir / "classification.json",
                {
                    "status": "PARTIALLY_LIVE",
                    "evidence_chain": {key: False for key in AUDIT.REQUIRED_CHAIN_KEYS},
                },
            )
            self.write_json(
                surface_dir / "screenshot_meta.json",
                {
                    "captured_at": captured_at,
                    "account_id": account_id,
                    "surface": slug,
                    "environment": "production",
                },
            )
            self.write_json(
                surface_dir / "parity.json",
                {
                    "checks": [
                        {
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
                        "provider": "bridge",
                        "status": "active",
                        "resource_id": f"bridge-resource-{slug}",
                    },
                )

            performance_surfaces[slug] = {
                metric: {"business": 100, "individual": 100}
                for metric in ("initial_render_ms", "time_to_data_ms", "loading_state_ms")
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
                "is_imported_account": False,
                "manual_db_intervention": False,
            },
        )
        self.write_json(
            root / AUDIT.MANIFEST_FILE,
            {
                "business_account_id": account_id,
                "business_email": email,
                "bridge_customer_id": bridge_customer_id,
                "kyb_status": "approved",
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

    def test_complete_valid_local_evidence_passes_without_production_access(self) -> None:
        self.build_valid_bundle()
        result, output = self.run_local_gate()
        self.assertEqual(result, 0)
        self.assertIn("rc1_business_certification_gate_audit: PASS", output)
        self.assertIn("Production account-tuple verification remains separately required", output)


if __name__ == "__main__":
    unittest.main()
