#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def read(path: str) -> str:
    return (ROOT / path).read_text()

worker = read('supabase/functions/process-pending-events/index.ts')
derive = read('utils/config/environment.ts')
kyc = read('components/kyc/KYCVerification.tsx')
signup = read('components/auth/SignUpFlow.tsx')

assert 'status === "not_started"' in worker and '? "not_started"' in worker
assert 'status === "incomplete"' in worker and '? "incomplete"' in worker
assert ': null;' in worker and 'ignored_unknown_status: true' in worker
assert "if (bridgeKyc === 'incomplete') return 'incomplete'" in derive
assert "if (bridgeKyc === 'not_started') return 'not_started'" in derive
assert "kyc_status: 'not_started'" in signup
assert 'Verification incomplete' in kyc
assert 'const openTopLevelTos' in kyc
assert 'openTopLevelTos(r.data.tos_link_url)' in kyc
assert "openHostedVerificationUrl(r.data.tos_link_url" not in kyc
assert 'if (!embedLoaded && embeddedReturnEnabled)' in kyc
assert 'referrerPolicy="no-referrer"' not in kyc
assert 'Continue verification <ArrowRight' in kyc

print('bridge KYC state regression audit passed')
