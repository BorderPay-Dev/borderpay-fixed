from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts/ci/verify_manual_intervention_audit.py"
SPEC = importlib.util.spec_from_file_location("verify_manual_intervention_audit", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load manual intervention verifier")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class ManualInterventionAuditTests(unittest.TestCase):
    def build(self, root: Path, *, mutation: bool = False) -> None:
        capture_id = "capture-real-001"
        account_id = "account-real-001"
        start = "2026-08-16T10:00:00Z"
        end = "2026-08-16T10:05:00Z"
        records = [
            {"timestamp": start, "user_name": "authenticator", "event_message": f"RC1_CERTIFICATION_AUDIT_START:{capture_id}"},
            {"timestamp": end, "user_name": "authenticator", "event_message": f"RC1_CERTIFICATION_AUDIT_END:{capture_id}"},
        ]
        if mutation:
            records.insert(1, {
                "timestamp": "2026-08-16T10:03:00Z",
                "user_name": "postgres",
                "event_message": "AUDIT: SESSION,WRITE,UPDATE,TABLE,public.business_profiles,UPDATE public.business_profiles SET bridge_kyb_status='approved'",
            })
        export = {
            "source": "supabase.logs.postgres",
            "project_ref": "orwrcpwsffjlvzuraxjc",
            "window_start": start,
            "window_end": end,
            "records": records,
        }
        raw = json.dumps(export, sort_keys=True).encode("utf-8")
        root.joinpath(VERIFY.DEFAULT_EXPORT_FILE).write_bytes(raw)
        metadata = {
            "authority_status": VERIFY.AUTHORITY_STATUS,
            "source": VERIFY.SOURCE,
            "project_ref": "orwrcpwsffjlvzuraxjc",
            "account_id": account_id,
            "capture_id": capture_id,
            "provider_export_id": "supabase-export-001",
            "provider_query_id": "supabase-query-001",
            "exported_by": "release-controller",
            "window_start": start,
            "window_end": end,
            "exported_at": end,
            "export_file": VERIFY.DEFAULT_EXPORT_FILE,
            "export_sha256": hashlib.sha256(raw).hexdigest(),
            "pgaudit_configuration": {
                "pgaudit.log": "write, ddl, role",
                "pgaudit.log_parameter": "on",
                "pgaudit.log_relation": "on",
                "shared_preload_libraries": "pg_stat_statements,pgaudit,plpgsql",
                "captured_at": start,
            },
        }
        root.joinpath(VERIFY.METADATA_FILE).write_text(json.dumps(metadata), encoding="utf-8")

    def test_missing_export_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            failures = VERIFY.validate_manual_intervention_audit(Path(tmp))
        self.assertTrue(any("missing" in failure for failure in failures))

    def test_clean_correlated_export_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            failures = VERIFY.validate_manual_intervention_audit(
                root, expected_account_id="account-real-001", expected_capture_id="capture-real-001",
            )
        self.assertEqual(failures, [])

    def test_hash_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            root.joinpath(VERIFY.DEFAULT_EXPORT_FILE).write_text("{}", encoding="utf-8")
            failures = VERIFY.validate_manual_intervention_audit(root)
        self.assertTrue(any("SHA-256 mismatch" in failure for failure in failures))

    def test_privileged_critical_mutation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root, mutation=True)
            failures = VERIFY.validate_manual_intervention_audit(root)
        self.assertTrue(any("privileged certification-critical mutation" in failure for failure in failures))

    def test_missing_markers_and_disabled_parameters_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.build(root)
            metadata_path = root / VERIFY.METADATA_FILE
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["pgaudit_configuration"]["pgaudit.log_parameter"] = "off"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            export_path = root / VERIFY.DEFAULT_EXPORT_FILE
            export = json.loads(export_path.read_text(encoding="utf-8"))
            export["records"] = [{"timestamp": export["window_start"], "user_name": "authenticator", "event_message": "no marker"}]
            raw = json.dumps(export, sort_keys=True).encode("utf-8")
            export_path.write_bytes(raw)
            metadata["export_sha256"] = hashlib.sha256(raw).hexdigest()
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            failures = VERIFY.validate_manual_intervention_audit(root)
        self.assertTrue(any("log_parameter must be on" in failure for failure in failures))
        self.assertTrue(any("start and end coverage markers" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
