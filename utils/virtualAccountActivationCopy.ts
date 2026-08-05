import { friendlyError } from './errors/friendlyError';

export type VirtualAccountActivationToast = {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
};

export function virtualAccountActivationMessage(res: any, currency: string): VirtualAccountActivationToast {
  const code = String(res?.code || res?.summary?.code || '').trim();
  const rawError = String(res?.error || '').trim();
  if (code === 'va_support_required') {
    return {
      type: 'warning',
      title: `${currency} account needs support`,
      message: rawError || `Contact support to activate ${currency} receiving for your account. Try again after support confirms it is enabled.`,
    };
  }
  if (code === 'external_wallet_required') {
    return {
      type: 'warning',
      title: 'External wallet required',
      message: rawError || 'Save your external USDC wallet on Base, then request this account again. Funds received through this account will be delivered to that wallet.',
    };
  }
  if (
    code === 'va_provider_pending' ||
    code === 'va_grant_pending' ||
    code === 'virtual_account_setup_pending' ||
    code === 'account_setup_pending' ||
    code === 'endorsement_required'
  ) {
    return {
      type: 'info',
      title: `${currency} account request received`,
      message: rawError || 'We received your request. Support will activate the account for you; no further action is required.',
    };
  }
  if (code === 'kyc_not_approved') {
    return {
      type: 'warning',
      title: 'Verification required',
      message: 'Complete identity verification before activating a foreign currency account.',
    };
  }
  if (code === 'no_customer') {
    return {
      type: 'warning',
      title: 'Account setup required',
      message: 'Complete account setup before activating a foreign currency account.',
    };
  }
  if (code === 'country_rail_not_supported' || code === 'bridge_country_blocked') {
    return {
      type: 'info',
      title: `${currency} account coming soon`,
      message: 'Foreign currency accounts are not available for your region yet.',
    };
  }
  if (/unable to connect|failed to fetch|network|internet|timed out|timeout/i.test(rawError)) {
    return {
      type: 'warning',
      title: 'Could not complete request',
      message: 'Please check your connection and try again. Your account and funds are safe.',
    };
  }
  return {
    type: 'error',
    title: `Could not open ${currency} account`,
    message: friendlyError(rawError, 'Please try again shortly or contact support if this continues.'),
  };
}
