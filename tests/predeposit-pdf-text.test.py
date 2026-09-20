from pathlib import Path
p=Path('/tmp/predeposit-pdf-qa')
a=(p/'approved.txt').read_text();b=(p/'pending.txt').read_text()
assert '12-34-56' in a and '12345678' in a
assert 'SIA Pārbaude' in a and 'Müller Trading Ltd' in a
assert 'Bank payment instructions' not in b and 'Account number:' not in b
assert 'Signed purchase order - original evidence' in a
print('PASS: PDF text, original evidence and no bank details in pending invoice')

copy=(p/'invoice-copy.txt').read_text()
assert 'INVOICE COPY - PAYMENT DETAILS NOT INCLUDED' in copy
assert '125.00 GBP' in copy and 'Müller Trading Ltd' in copy
for private in ['Bank payment instructions','Account number:','Source of funds','Use of funds:','Evidence assessment:','Evidence manifest','Signed purchase order - original evidence']:
    assert private not in copy, private
print('PASS: shareable invoice has billing only, with no bank coordinates or private dossier')

observation=(p/'observation-invoice.txt').read_text()
assert 'Bank payment instructions' in observation and '12-34-56' in observation and 'TEST-ONLY' in observation
assert 'PAYMENT DETAILS NOT INCLUDED' not in observation
assert 'UNDER REVIEW - NOT PAYMENT INSTRUCTIONS' not in observation
for private in ['Source of funds','Use of funds:','Evidence assessment:','Evidence manifest']:
    assert private not in observation, private
print('PASS: observation invoice includes the selected bank details without private review data')
