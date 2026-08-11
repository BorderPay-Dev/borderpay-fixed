/**
 * Customer-facing provider branding normalizer.
 *
 * Rule: infrastructure provider names must never be rendered directly in
 * end-user copy. Internal ids/contracts remain unchanged.
 */

const BRANDING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bbridge wallet activity\b/gi, 'account activity'],
  [/\bbridge wallet\b/gi, 'BorderPay Wallet'],
  [/\bbridge deposit\b/gi, 'Wallet Deposit'],
  [/\bbridge transfer\b/gi, 'Transfer'],
  [/\bbridge account\b/gi, 'BorderPay account'],
  [/\byellow\s*card\b/gi, 'local payment rail'],
  [/\byellowcard\b/gi, 'local payment rail'],
  [/\bvia bridge\b/gi, 'via BorderPay'],
  [/\bbridge\b/gi, 'BorderPay'],
];

export function sanitizeCustomerFacingText(input: string | null | undefined): string {
  const value = String(input ?? '');
  if (!value) return '';

  return BRANDING_REPLACEMENTS.reduce((next, [pattern, replacement]) => {
    return next.replace(pattern, replacement);
  }, value);
}
