/** Keep supported saved destinations intact while regional eligibility loads. */
export function retainSavedExternalWallets<T extends { asset: string; chain: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row && typeof row === 'object').map(row => ({
    ...row,
    asset: String(row.asset ?? '').trim().toUpperCase(),
    chain: String(row.chain ?? '').trim().toLowerCase(),
  })).filter(row => ['USDC:base', 'EURC:base', 'USDT:tron'].includes(`${row.asset}:${row.chain}`));
}
