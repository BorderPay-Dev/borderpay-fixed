import { deriveAccountAccessState } from '../../utils/accountAccessStatus';

const cases: Array<[string, Record<string, unknown>, string]> = [
  ['individual KYC rejection', { account_type: 'individual', bridge_kyc_status: 'rejected' }, 'verification_rejected'],
  ['business KYB rejection', { account_type: 'business', bridge_kyb_status: 'rejected' }, 'verification_rejected'],
  ['Bridge account rejection', { bridge_account_status: 'rejected' }, 'verification_rejected'],
  ['paused takes precedence over rejection', { bridge_account_status: 'paused', bridge_kyc_status: 'rejected' }, 'paused'],
  ['explicit freeze takes precedence over rejection', { account_status: 'frozen', bridge_kyc_status: 'rejected' }, 'frozen'],
  ['offboarded account', { bridge_account_status: 'offboarded' }, 'closed'],
  ['under review', { bridge_kyc_status: 'under_review' }, 'under_review'],
  ['awaiting RFI', { bridge_kyc_status: 'awaiting_rfi' }, 'awaiting_rfi'],
  ['needs EDD', { bridge_kyc_status: 'needs_edd' }, 'needs_edd'],
  ['needs UBOs', { account_type: 'business', bridge_kyb_status: 'needs_ubos' }, 'needs_ubos'],
  ['incomplete', { bridge_kyc_status: 'incomplete' }, 'incomplete'],
  ['approved overrides stale legacy pending', { bridge_kyc_status: 'approved', kyc_status: 'pending' }, 'active'],
  ['active account with no verification state', { bridge_account_status: 'active' }, 'active'],
];

for (const [name, profile, expected] of cases) {
  const actual = deriveAccountAccessState(profile);
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, received ${actual}`);
  }
  console.log(`[OK] ${name}: ${actual}`);
}

console.log(`account_status_display_mapping_cases: PASS (${cases.length}/${cases.length})`);
