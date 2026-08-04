export type AccountAccessState =
  | 'active'
  | 'frozen'
  | 'paused'
  | 'closed'
  | 'verification_rejected'
  | 'under_review'
  | 'awaiting_rfi'
  | 'needs_edd'
  | 'needs_ubos'
  | 'incomplete';

type AccountStatusProfile = {
  account_type?: string | null;
  account_status?: string | null;
  bridge_account_status?: string | null;
  bridge_kyc_status?: string | null;
  bridge_kyb_status?: string | null;
  kyc_status?: string | null;
};

const normalize = (value: unknown) =>
  String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const FROZEN = new Set(['frozen', 'compliance_hold', 'compliance_frozen']);
const PAUSED = new Set(['paused', 'risk_paused', 'restricted', 'blocked', 'suspended']);
const CLOSED = new Set(['offboarded', 'closed', 'terminated', 'deactivated']);

/**
 * Maps provider/profile state to user-facing access state without changing any
 * backend authorization or money-movement decision.
 *
 * Account restrictions take precedence over verification state: an explicit
 * freeze/hold must never be disguised as a verification problem.
 */
export function deriveAccountAccessState(profile: AccountStatusProfile | null | undefined): AccountAccessState {
  if (!profile) return 'active';

  const localAccount = normalize(profile.account_status);
  const bridgeAccount = normalize(profile.bridge_account_status);
  const accountStates = [localAccount, bridgeAccount];

  if (accountStates.some((status) => FROZEN.has(status))) return 'frozen';
  if (accountStates.some((status) => PAUSED.has(status))) return 'paused';
  if (accountStates.some((status) => CLOSED.has(status))) return 'closed';

  const accountType = normalize(profile.account_type);
  const primaryVerification = accountType === 'business'
    ? normalize(profile.bridge_kyb_status)
    : normalize(profile.bridge_kyc_status);
  const verificationStates = [
    primaryVerification,
    normalize(profile.bridge_kyc_status),
    normalize(profile.bridge_kyb_status),
    normalize(profile.kyc_status),
    bridgeAccount,
  ];

  if (verificationStates.some((status) => status === 'rejected' || status === 'failed')) {
    return 'verification_rejected';
  }
  if (['approved', 'active', 'authorized', 'verified'].includes(primaryVerification)) return 'active';
  if (verificationStates.includes('awaiting_rfi')) return 'awaiting_rfi';
  if (verificationStates.includes('needs_edd')) return 'needs_edd';
  if (verificationStates.includes('needs_ubos')) return 'needs_ubos';
  if (verificationStates.includes('under_review')) return 'under_review';
  if (verificationStates.some((status) => ['incomplete', 'pending', 'not_started'].includes(status))) {
    return 'incomplete';
  }
  if (['approved', 'active', 'authorized'].includes(bridgeAccount)) return 'active';

  return 'active';
}
