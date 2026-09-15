/** Address syntax is independent of regional eligibility, enforced by the payout API. */
export function isValidCryptoAddress(network: 'tron' | 'base', address: string): boolean {
  const value = String(address || '').trim();
  if (network === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  if (network === 'base') return /^0x[a-fA-F0-9]{40}$/.test(value);
  return false;
}
