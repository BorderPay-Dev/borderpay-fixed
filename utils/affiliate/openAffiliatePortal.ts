import { backendAPI } from '../api/backendAPI';
import { affiliateProgramUrl } from './config';

const AFFILIATE_ORIGIN = 'https://affiliate.borderpayafrica.com';

function safeAffiliateUrl(value: unknown, fallback: string): string {
  try {
    const url = new URL(String(value || ''));
    if (url.origin === AFFILIATE_ORIGIN && url.pathname === '/login') return url.toString();
  } catch {
    // Fall through to the fixed login URL.
  }
  return fallback;
}

export async function openAffiliatePortal(
  source: 'banner' | 'referral_screen' | 'drawer' = 'referral_screen',
): Promise<void> {
  const fallback = affiliateProgramUrl(source);
  const popup = window.open('about:blank', '_blank');
  if (popup) {
    popup.opener = null;
    popup.document.title = 'Opening BorderPay Affiliates…';
  }

  let destination = fallback;
  try {
    const response = await backendAPI.affiliate.getSSOLink();
    destination = safeAffiliateUrl(response.data?.url, fallback);
  } catch {
    // Direct BorderPay credentials remain available if SSO is unavailable.
  }

  if (popup && !popup.closed) popup.location.replace(destination);
  else window.location.assign(destination);
}
