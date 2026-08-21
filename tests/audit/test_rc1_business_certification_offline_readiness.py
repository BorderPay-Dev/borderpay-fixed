from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class OfflineReadinessAuditTests(unittest.TestCase):
    def test_static_trace_completes_with_external_manual_audit_contract(self) -> None:
        result = subprocess.run(
            [sys.executable, "tests/audit/rc1_business_certification_offline_readiness_audit.py"],
            cwd=ROOT, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Immutable account origin distinguishes", result.stdout)
        self.assertIn("manual_db_intervention uses verified external pgaudit export", result.stdout)
        self.assertIn("session activity POST applies globally", result.stdout)


if __name__ == "__main__":
    unittest.main()
