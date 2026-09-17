#!/usr/bin/env python3
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
UI = (ROOT / 'components/business/OperatorBridgeReadOnlyApp.tsx').read_text()
CSS = (ROOT / 'components/business/treasury/treasury.css').read_text()
checks = {
 'safe areas on all edges': all(f'safe-area-inset-{edge}' in CSS for edge in ['top','right','bottom','left']),
 'dynamic viewport with scroll': '100svh' in CSS and '100dvh' in CSS and 'overflow-y:auto' in CSS,
 'standalone adaptation': 'display-mode:standalone' in CSS,
 'small phone and landscape adaptation': 'max-width:359px' in CSS and 'max-height:540px' in CSS,
 'touch sized controls': 'min-height:44px' in CSS and 'min-height:52px' in CSS,
 'motion preferences respected': 'prefers-reduced-motion:reduce' in CSS,
 'responsive chart': 'preserveAspectRatio="xMidYMid meet"' in UI,
 'viewport restored after treasury unmount': "classList.remove('bp-treasury-active')" in UI,
 'keyboard skip and focus visible': 'Skip to treasury content' in UI and ':focus-visible' in CSS,
 'consumer screens remain independent': 'MainApp' not in UI and 'BusinessDashboard' not in UI,
}
for name, passed in checks.items(): print(('PASS' if passed else 'FAIL') + ': ' + name)
if not all(checks.values()): raise SystemExit(1)
print(f'PASS: {len(checks)}/{len(checks)} treasury responsive invariants')
