from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class AccountOriginProvenanceTests(unittest.TestCase):
    def test_origin_contract_and_certification_integration(self) -> None:
        result = subprocess.run(
            [sys.executable, "tests/audit/account_origin_provenance_audit.py"],
            cwd=ROOT, text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("account_origin_provenance_audit: PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
