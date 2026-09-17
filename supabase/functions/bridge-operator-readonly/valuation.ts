export type TreasuryBalance = { id: string; currency: string; chain: string; balance_available: boolean; balances: Array<{ currency: string; balance: string }> };
export type UsdRates = { USDC: number; USDT: number | null; EURC: number | null };
export type WalletBalanceEvent = { id: string; bridge_wallet_id: string; currency: string; available_balance: string; created_at: string };
const decimal = (value: unknown) => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
export function bridgeMidmarketRate(payload: any, now: number): number | null {
  const data = payload?.data ?? payload;
  const rate = decimal(String(data?.midmarket_rate ?? ''));
  const updated = Date.parse(data?.updated_at ?? '');
  return rate !== null && rate > 0 && Number.isFinite(updated) && now - updated <= 300_000 && updated <= now + 60_000 ? rate : null;
}
function walletAmount(wallet: TreasuryBalance): number | null {
  if (!wallet.balance_available) return null;
  const matches = wallet.balances.filter(row => row.currency.toUpperCase() === wallet.currency.toUpperCase());
  if (matches.length !== 1) return null;
  return decimal(matches[0].balance);
}
function usd(amount: number, currency: string, rates: UsdRates): number | null {
  if (amount === 0) return 0;
  const rate = rates[currency as keyof UsdRates];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? amount * rate : null;
}
export function treasuryUsdTotal(wallets: TreasuryBalance[], walletsAvailable: boolean, rates: UsdRates): number | null {
  if (!walletsAvailable || !wallets.length) return null;
  let total = 0;
  const seen = new Set<string>();
  for (const wallet of wallets) {
    const key = `${wallet.id}:${wallet.currency.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const balance = walletAmount(wallet);
    const value = balance === null ? null : usd(balance, wallet.currency.toUpperCase(), rates);
    if (value === null) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

// Every point uses Bridge's after-event wallet balance. VA gross receipts never
// enter this calculation. Past token balances are valued at the current rates,
// explicitly labelled as such by the UI (not historical FX or realized P&L).
export function treasuryBalanceHistory(wallets: TreasuryBalance[], events: WalletBalanceEvent[], complete: boolean, rates: UsdRates, now: number) {
  const amounts = new Map(wallets.map(wallet => [`${wallet.id}:${wallet.currency.toUpperCase()}`, 0]));
  const points: Array<{ at: string; usd: number }> = [];
  if (!complete || !wallets.length) return { complete: false, points };
  const sorted = [...events].sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const event of sorted) {
    if (typeof event.currency !== "string" || typeof event.id !== "string") return { complete: false, points: [] };
    const key = `${event.bridge_wallet_id}:${event.currency.toUpperCase()}`;
    if (!amounts.has(key) || seen.has(event.id)) continue;
    seen.add(event.id);
    const value = decimal(event.available_balance);
    const time = Date.parse(event.created_at);
    if (value === null || !Number.isFinite(time) || time > now) return { complete: false, points: [] };
    amounts.set(key, value);
    let total = 0;
    for (const [assetKey, balance] of amounts) {
      const part = usd(balance, assetKey.split(':').pop()!, rates);
      if (part === null) return { complete: false, points: [] };
      total += part;
    }
    points.push({ at: event.created_at, usd: total });
  }
  // A limited, stale or inconsistent history cannot reconstruct the live balance.
  for (const wallet of wallets) {
    const balance = walletAmount(wallet);
    const recorded = amounts.get(`${wallet.id}:${wallet.currency.toUpperCase()}`)!;
    if (balance === null || Math.abs(balance - recorded) > 0.000001) return { complete: false, points: [] };
  }
  const total = treasuryUsdTotal(wallets, true, rates);
  if (total === null) return { complete: false, points: [] };
  points.push({ at: new Date(now).toISOString(), usd: total });
  return { complete: true, points };
}
