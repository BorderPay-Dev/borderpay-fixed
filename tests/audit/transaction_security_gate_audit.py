from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEND = (ROOT / 'components/send/SendMoneyFlow.tsx').read_text()
RECEIVE = (ROOT / 'components/receive/ReceiveMoneyScreen.tsx').read_text()
GATE = (ROOT / 'components/security/TransactionSecurityGate.tsx').read_text()

failures = []
for label, source in [('send', SEND), ('receive', RECEIVE)]:
    if 'TransactionSecurityGate' not in source:
        failures.append(f'{label} does not render the security setup gate')
    if "onNavigate?.('pin-setup')" not in source:
        failures.append(f'{label} does not link directly to PIN setup')
    if "onNavigate?.('biometric-setup')" not in source:
        failures.append(f'{label} does not link directly to biometric setup')
if 'Two-factor authentication is optional.' not in GATE:
    failures.append('gate does not explain that 2FA is optional')
if 'One option is required for transactions.' not in GATE:
    failures.append('gate does not require PIN or biometric')

if failures:
    print('transaction_security_gate_audit: FAIL')
    for failure in failures:
        print(f' - {failure}')
    raise SystemExit(1)

print('transaction_security_gate_audit: PASS')
