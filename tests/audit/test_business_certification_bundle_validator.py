from __future__ import annotations

import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts/ci/validate_business_certification_bundle.py"
SPEC = importlib.util.spec_from_file_location("validate_business_certification_bundle", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load bundle validator")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class BusinessCertificationBundleValidatorTests(unittest.TestCase):
    @staticmethod
    def write_context(root: Path) -> None:
        root.joinpath("capture_context.json").write_text(json.dumps({
            "capture_id": "capture-001",
            "business_account_id": "account-001",
            "rc1_git_commit": "a" * 40,
            "build_id": "build-001",
            "build_artifact_sha256": "c" * 64,
            "deployment_attestation_id": "attestation-001",
        }), encoding="utf-8")

    @staticmethod
    def write_surface(root: Path, slug: str, *, api_capture: str = "capture-001", bridge_id: str | None = None) -> None:
        surface = root / slug
        surface.mkdir()
        timestamp = "2026-08-16T10:00:00Z"
        common = {"capture_id": "capture-001", "account_id": "account-001", "captured_at": timestamp}
        resource = bridge_id or "resource-001"
        surface.joinpath("api.json").write_text(json.dumps({**common, "capture_id": api_capture, "payload": {"state": "ok", "resource_id": resource}}), encoding="utf-8")
        surface.joinpath("snapshot.json").write_text(json.dumps({**common, "payload": {"state": "ok", "resource_id": resource}}), encoding="utf-8")
        surface.joinpath("classification.json").write_text(json.dumps({**common, "status": "PARTIALLY_LIVE"}), encoding="utf-8")
        surface.joinpath("parity.json").write_text(json.dumps({**common, "checks": [{"field": "state", "match": True, "api_value": "ok", "snapshot_value": "ok"}]}), encoding="utf-8")
        surface.joinpath("screenshot_meta.json").write_text(json.dumps({
            **common, "surface": slug, "environment": "production", "rc1_git_commit": "a" * 40,
            "build_id": "build-001", "build_artifact_sha256": "c" * 64,
            "deployment_attestation_id": "attestation-001",
        }), encoding="utf-8")
        png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 1, 1) + b"\x08\x06\x00\x00\x00" + b"\x00\x00\x00\x00"
        surface.joinpath("screenshot.png").write_bytes(png)

    def test_missing_context_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            failures = VALIDATOR.validate_bundle(Path(tmp))
        self.assertTrue(any("capture_context.json" in failure for failure in failures))

    def test_empty_context_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "capture_context.json").write_text("{}", encoding="utf-8")
            failures = VALIDATOR.validate_bundle(Path(tmp))
        self.assertTrue(any("non-empty" in failure for failure in failures))

    def test_placeholder_identity_and_missing_surfaces_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "capture_context.json").write_text(json.dumps({
                "capture_id": "sample-capture",
                "business_account_id": "example-account",
                "rc1_git_commit": "bad",
                "build_id": "placeholder",
                "build_artifact_sha256": "bad",
                "deployment_attestation_id": "mock-attestation",
            }), encoding="utf-8")
            failures = VALIDATOR.validate_bundle(Path(tmp))
        self.assertTrue(any("non-placeholder" in failure for failure in failures))
        self.assertTrue(any("missing surface directory" in failure for failure in failures))

    def test_empty_or_non_png_surface_evidence_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.joinpath("capture_context.json").write_text(json.dumps({
                "capture_id": "capture-001",
                "business_account_id": "account-001",
                "rc1_git_commit": "a" * 40,
                "build_id": "build-001",
                "build_artifact_sha256": "c" * 64,
                "deployment_attestation_id": "attestation-001",
            }), encoding="utf-8")
            surface = root / "dashboard"
            surface.mkdir()
            for name in ("api.json", "snapshot.json", "screenshot_meta.json", "parity.json", "classification.json"):
                surface.joinpath(name).write_text("{}", encoding="utf-8")
            surface.joinpath("screenshot.png").write_bytes(b"")
            failures = VALIDATOR.validate_bundle(root)
        self.assertTrue(any("screenshot.png" in failure for failure in failures))
        self.assertTrue(any("JSON object must be non-empty" in failure for failure in failures))

    def test_capture_id_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_context(root)
            self.write_surface(root, "dashboard", api_capture="different-capture")
            failures = VALIDATOR.validate_bundle(root)
        self.assertTrue(any("dashboard: api.capture_id mismatch" in failure for failure in failures))

    def test_bridge_id_must_correlate_to_api_and_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_context(root)
            self.write_surface(root, "wallets", bridge_id="wallet-in-captures")
            bridge = {
                "capture_id": "capture-001", "account_id": "account-001",
                "captured_at": "2026-08-16T10:00:00Z", "provider": "bridge",
                "status": "active", "wallet_id": "different-wallet",
            }
            root.joinpath("wallets", "bridge.json").write_text(json.dumps(bridge), encoding="utf-8")
            failures = VALIDATOR.validate_bundle(root)
        self.assertTrue(any("Bridge resource ID missing from api.json" in failure for failure in failures))
        self.assertTrue(any("Bridge resource ID missing from snapshot.json" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
