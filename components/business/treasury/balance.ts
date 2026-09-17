export type TreasuryValuation = {
  currency: 'USD'; total: string | null; as_of: string;
  history: { complete: boolean; points: Array<{ at: string; usd: number }> };
};
export function valuationTotal(valuation?: TreasuryValuation): number | null {
  const value = valuation?.total;
  return valuation?.currency === 'USD' && typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
}
export function balanceDays(valuation: TreasuryValuation | undefined, count: number) {
  if (!valuation?.history.complete || valuationTotal(valuation) === null) return [];
  const now = Date.parse(valuation.as_of);
  if (!Number.isFinite(now)) return [];
  const day = 86400000;
  const end = Math.floor(now / day) * day;
  const points = [...valuation.history.points].sort((a,b) => Date.parse(a.at) - Date.parse(b.at));
  if (points.some(p => !Number.isFinite(Date.parse(p.at)) || Date.parse(p.at) > now || !Number.isFinite(p.usd) || p.usd < 0)) return [];
  let cursor = 0, balance = 0;
  return Array.from({ length: count }, (_,i) => {
    const time = end - (count - 1 - i) * day;
    while (cursor < points.length && Date.parse(points[cursor].at) < time + day) balance = points[cursor++].usd;
    return { time, value: balance };
  });
}
