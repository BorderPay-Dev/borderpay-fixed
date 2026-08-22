from __future__ import annotations

import base64
import datetime as dt
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).resolve().parents[2] / "scripts/ci/verify_external_audit_ledger.py"
SPEC = importlib.util.spec_from_file_location("verify_external_audit_ledger", MODULE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load external audit verifier")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class ExternalAuditLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.private_key = self.root / "private.pem"
        self.public_key = self.root / VERIFY.PUBLIC_KEY_FILE
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(self.private_key)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(self.private_key), "-pubout", "-out", str(self.public_key)], check=True, capture_output=True)
        self.key_hash = hashlib.sha256(self.public_key.read_bytes()).hexdigest()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def sign(self, value: dict) -> str:
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        payload_path = self.root / "receipt-payload"
        signature_path = self.root / "receipt-signature"
        payload_path.write_bytes(payload)
        subprocess.run([
            "openssl", "pkeyutl", "-sign", "-inkey", str(self.private_key), "-rawin",
            "-in", str(payload_path), "-out", str(signature_path),
        ], check=True, capture_output=True)
        return base64.b64encode(signature_path.read_bytes()).decode()

    def build(self, *, gap: bool = False, tamper_signature: bool = False) -> None:
        start = "2026-08-22T10:00:00Z"
        end = "2026-08-22T10:05:00Z"
        capture_id = "capture-live-001"
        account_id = "11111111-1111-4111-8111-111111111111"
        prior_hash = "0" * 64
        records = []
        for index, marker in enumerate(("START", "END"), start=1):
            sequence = index + 1 if gap and index == 2 else index
            event_id = f"00000000-0000-4000-8000-{index:012d}"
            occurred_at = start if marker == "START" else end
            values = {"capture_id": capture_id, "account_id": account_id, "marker_kind": marker}
            record = {
                "sequence_no": sequence,
                "event_id": event_id,
                "occurred_at": occurred_at,
                "schema_name": "certification",
                "table_name": "control",
                "operation": "MARKER",
                "record_key": account_id,
                "changed_fields": [marker],
                "actor": {"session_user": "authenticator", "current_user": "service_role"},
                "old_values": None,
                "new_values": values,
            }
            chain_payload = json.dumps(record, sort_keys=True, separators=(",", ":"))
            event_hash = hashlib.sha256((prior_hash + chain_payload).encode()).hexdigest()
            receipt = {
                "receipt_id": f"receipt-{index}", "event_id": event_id,
                "sequence_no": sequence, "event_hash": event_hash,
                "stored_at": occurred_at, "retention_until": "2026-09-30T10:05:00Z",
                "object_lock_mode": "COMPLIANCE", "key_id": "sink-key-2026-01",
            }
            signature = self.sign(receipt)
            if tamper_signature and index == 2:
                signature = base64.b64encode(b"invalid").decode()
            records.append({**record, "chain_payload": chain_payload, "previous_hash": prior_hash,
                            "event_hash": event_hash, "receipt": {**receipt, "signature": signature}})
            prior_hash = event_hash
        export = {
            "source": "borderpay.external_worm_audit.v1", "project_ref": "orwrcpwsffjlvzuraxjc",
            "window_start": start, "window_end": end, "anchor_sequence": 0,
            "anchor_hash": "0" * 64, "records": records,
        }
        raw = json.dumps(export, sort_keys=True).encode()
        (self.root / VERIFY.EXPORT_FILE).write_bytes(raw)
        metadata = {
            "authority_status": VERIFY.AUTHORITY_STATUS, "source": VERIFY.SOURCE,
            "project_ref": "orwrcpwsffjlvzuraxjc", "account_id": account_id,
            "capture_id": capture_id, "provider": "independent-worm-provider",
            "provider_export_id": "export-live-001", "exported_by": "release-controller",
            "sink_key_id": "sink-key-2026-01", "window_start": start, "window_end": end,
            "exported_at": end, "object_lock_mode": "COMPLIANCE", "minimum_retention_days": 30,
            "sink_public_key_sha256": self.key_hash, "export_file": VERIFY.EXPORT_FILE,
            "export_sha256": hashlib.sha256(raw).hexdigest(),
        }
        (self.root / "manual_intervention_audit.json").write_text(json.dumps(metadata), encoding="utf-8")

    def test_valid_signed_contiguous_export_passes(self) -> None:
        self.build()
        self.assertEqual(VERIFY.validate_external_audit_ledger(
            self.root, expected_account_id="11111111-1111-4111-8111-111111111111",
            expected_capture_id="capture-live-001", trusted_public_key_sha256=self.key_hash,
        ), [])

    def test_missing_trusted_key_fails_closed(self) -> None:
        self.build()
        failures = VERIFY.validate_external_audit_ledger(self.root, trusted_public_key_sha256="")
        self.assertTrue(any("trusted external audit public key" in failure for failure in failures))

    def test_sequence_gap_and_invalid_signature_fail(self) -> None:
        self.build(gap=True, tamper_signature=True)
        failures = VERIFY.validate_external_audit_ledger(self.root, trusted_public_key_sha256=self.key_hash)
        self.assertTrue(any("sequence gap" in failure for failure in failures))
        self.assertTrue(any("signature invalid" in failure for failure in failures))

    def test_modified_export_fails_hash(self) -> None:
        self.build()
        path = self.root / VERIFY.EXPORT_FILE
        path.write_bytes(path.read_bytes() + b"\n")
        failures = VERIFY.validate_external_audit_ledger(self.root, trusted_public_key_sha256=self.key_hash)
        self.assertTrue(any("export SHA-256 mismatch" in failure for failure in failures))


if __name__ == "__main__":
    unittest.main()
