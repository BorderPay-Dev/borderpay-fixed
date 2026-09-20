"""Resolve the executable VA wrapper/handler pair for source audits.

The compatibility handler must actually be wired into the boundary. Its
production snapshot hashes are verified; inactive files cannot satisfy checks.
Runtime authorization and response tests live in predeposit-http-boundary.test.ts.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VA = ROOT / "supabase/functions/bridge-virtual-account/index.ts"
PRESERVED = VA.parent / "production-v384"

def audited_source(path: Path) -> str:
    src = path.read_text(encoding="utf-8")
    if path.resolve() != VA.resolve():
        return src
    match = re.search(r'import\s*\{legacyVirtualAccountHandler\}\s*from\s*"([^"]+)"', src)
    if not match:
        raise AssertionError("VA compatibility handler import missing")
    target = (path.parent / match.group(1)).resolve()
    assert target == (PRESERVED / "bridge-virtual-account/index.js").resolve()
    assert re.search(r"handle:\s*legacyVirtualAccountHandler\s*[,}]", src)
    assert re.search(r"Deno\.serve\(req=>withInvoiceInstructionBoundary\(req,", src)
    manifest = json.loads((PRESERVED / "PROVENANCE.json").read_text())
    for entry in manifest["files"]:
        module = ROOT / entry["target"]
        assert module.resolve().is_relative_to(PRESERVED.resolve())
        assert hashlib.sha256(module.read_bytes()).hexdigest() == entry["compiled_sha256"], entry["target"]
    handler = target.read_text()
    assert "export const legacyVirtualAccountHandler = async (req) =>" in handler
    return src + "\n" + handler
