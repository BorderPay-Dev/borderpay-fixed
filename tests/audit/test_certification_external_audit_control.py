from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class CertificationExternalAuditControlTests(unittest.TestCase):
    def test_static_control_contract(self) -> None:
        result = subprocess.run(
            [sys.executable, "tests/audit/certification_external_audit_control_audit.py"],
            cwd=ROOT, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
