import { friendlyError } from './errors/friendlyError';

export type VirtualAccountActivationToast = {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
};

export function virtualAccountActivationMessage(res: any, currency: string): VirtualAccountActivationToast {
  const code = String(res?.code || res?.summary?.code || '').trim();
  const rawError = String(res?.error || '').trim();
  if (
    code === 'va_grant_pending' ||
    code === 'virtual_account_setup_pending' ||
    code === 'account_setup_pending' ||
    code === 'endorsement_required'
  ) {
    return {
      type: 'info',
      title: `${currency} account request received`,
      message: rawError || 'This foreign currency account is being enabled. We will notify you once it is ready.',
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
