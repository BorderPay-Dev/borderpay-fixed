export type WalletStatus = 'locked' | 'pending' | 'active' | 'suspended';

interface DeriveWalletStatusInput {
  account_type?: string | null;
  bridge_kyc_status?: string | null;
  bridge_kyb_status?: string | null;
  bridge_account_status?: string | null;
  is_unlocked?: boolean | null;
  has_funding_surface?: boolean | null;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function deriveWalletStatus(input: DeriveWalletStatusInput): WalletStatus {
  const accountType = norm(input.account_type) === 'business' ? 'business' : 'individual';
  const bridgeAccount = norm(input.bridge_account_status);
  const verification = accountType === 'business'
    ? norm(input.bridge_kyb_status)
    : norm(input.bridge_kyc_status);
  const verificationPassed = ['approved', 'active', 'authorized', 'verified', 'completed', 'complete'].includes(verification);
  const accountActive = ['active', 'approved', 'authorized'].includes(bridgeAccount);
  const unlocked = Boolean(input.is_unlocked);
  const hasFundingSurface = Boolean(input.has_funding_surface);

  if (['suspended', 'blocked', 'rejected'].includes(bridgeAccount)) return 'suspended';
  if (unlocked) return 'active';
  if ((verificationPassed || accountActive) && hasFundingSurface) return 'active';
  if ((verificationPassed || accountActive) && !hasFundingSurface) return 'pending';
  if (['under_review', 'pending', 'incomplete', 'not_started'].includes(verification)) return 'locked';
  return 'locked';
}
