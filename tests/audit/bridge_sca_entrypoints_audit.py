#!/usr/bin/env python3
"""Every Bridge transfer caller must enforce request-bound SCA or reject EEA."""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
callers = {
    "bridge-transfer": "consumeScaAuthorization",
    "bridge-bulk-payout": "guardUnattestedTransfer",
    "bridge-operator-readonly": "guardUnattestedTransfer",
    "public-api-gateway": "guardUnattestedTransfer",
}
for path in (root / 'supabase/functions').glob('*/index.ts'):
    source = path.read_text()
    if 'bridgeProvider.createTransfer(' not in source:
        continue
    guard = callers.get(path.parent.name)
    assert guard and guard in source, f'Unguarded transfer entrypoint: {path.parent.name}'
    assert source.index(f'await {guard}(') < source.index('await bridgeProvider.createTransfer('), path
print('Bridge SCA entrypoint coverage: PASS (4 entrypoints)')
