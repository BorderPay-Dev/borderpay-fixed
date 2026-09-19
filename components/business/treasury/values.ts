export function walletBalance(wallet: { currency: string; chain: string; balance_available: boolean; balances: Array<{ currency: string; chain?: string; balance: string }> }): number | null {
  if (!wallet.balance_available) return null;
  const rows = wallet.balances.filter(row => row.currency.toUpperCase() === wallet.currency.toUpperCase() && (!row.chain || row.chain.toLowerCase() === wallet.chain.toLowerCase()));
  if (!rows.length || rows.some(row => !row.balance.trim() || !Number.isFinite(Number(row.balance)))) return null;
  return rows.reduce((sum, row) => sum + Number(row.balance), 0);
}
export function formatSortCode(value?: string): string {
  const digits = String(value || '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits.match(/.{2}/g)!.join('-') : '';
}
export function isPending(state: string): boolean {
  return ['pending', 'awaiting_funds', 'in_review', 'funds_received', 'payment_submitted', 'processing', 'submitted'].includes(state.toLowerCase());
}
