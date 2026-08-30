type AfricanRailsProfile = {
  id?: string | null;
  account_type?: string | null;
  bridge_customer_id?: string | null;
  bridge_kyc_status?: string | null;
  bridge_kyb_status?: string | null;
};

/**
 * Whether the client may ask the authoritative backend for live rail policy.
 *
 * Do not use cached Bridge verification fields here: those fields can lag the
 * server after KYC/KYB approval and would hide production rails before the
 * backend has a chance to evaluate the current identity. The Edge Function is
 * the authorization boundary and still fails closed for unverified accounts.
 */
export function canDiscoverAfricanRails(input?: Pick<AfricanRailsProfile, 'id'> | null): boolean {
  return Boolean(String(input?.id || '').trim());
}

/**
 * Client visibility hint only. The Edge Functions independently enforce the
 * authoritative Bridge identity and verification invariant on every request.
 */
export function canUseAfricanRails(input?: AfricanRailsProfile | null): boolean {
  if (!input?.id || !String(input.bridge_customer_id || '').trim()) return false;
  const isBusiness = String(input.account_type || '').trim().toLowerCase() === 'business';
  const status = String(isBusiness ? input.bridge_kyb_status : input.bridge_kyc_status)
    .trim()
    .toLowerCase();
  return status === 'approved';
}
