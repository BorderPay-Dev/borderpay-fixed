from pathlib import Path
p=Path('/tmp/predeposit-pdf-qa')
a=(p/'approved.txt').read_text();b=(p/'pending.txt').read_text()
assert '12-34-56' in a and '12345678' in a
assert 'SIA Pārbaude' in a and 'Müller Trading Ltd' in a
assert 'Bank payment instructions' not in b and 'Account number:' not in b
assert 'Signed purchase order - original evidence' in a
print('PASS: PDF text, original evidence and no bank details in pending invoice')
