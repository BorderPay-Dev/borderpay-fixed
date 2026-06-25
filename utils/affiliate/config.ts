export const AFFILIATE_BASE_URL = 'https://affiliate.borderpayafrica.com/login';

export function affiliateProgramUrl(source: 'banner' | 'referral_screen' | 'drawer' = 'referral_screen'): string {
  const url = new URL(AFFILIATE_BASE_URL);
  url.searchParams.set('utm_source', 'borderpay_app');
  url.searchParams.set('utm_medium', 'in_app');
  url.searchParams.set('utm_campaign', source);
  return url.toString();
}
