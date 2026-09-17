export type TreasuryActivity = {
  id: string; state: string; created_at: string; updated_at: string;
  source: { currency: string; payment_rail: string; amount: string };
  destination: { currency: string; payment_rail: string; amount: string };
};
export const VOLUME_PERIODS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 } as const;
export type VolumePeriod = keyof typeof VOLUME_PERIODS;
const DAY = 86400000;
const completed = new Set(['completed', 'payment_processed', 'settlement_complete']);
export const utcDay = (time: number) => Math.floor(time / DAY) * DAY;
export const dayLabel = (time: number) => new Date(time).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

export function activityAmount(row: TreasuryActivity, currency: string): number | null {
  if (!completed.has(row.state.toLowerCase())) return null;
  // Each transaction contributes once in the selected currency. For a same-token
  // transfer, volume is the source amount; don't count both legs or assume FX.
  for (const leg of [row.source, row.destination]) {
    if (leg.currency.toUpperCase() !== currency || !/^\d+(\.\d+)?$/.test(leg.amount)) continue;
    const value = Number(leg.amount);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function volumeSeries(rows: TreasuryActivity[], currency: string, period: VolumePeriod, now: number) {
  const end = utcDay(now) + DAY;
  const start = end - VOLUME_PERIODS[period] * DAY;
  const days = Array.from({ length: VOLUME_PERIODS[period] }, (_, index) => ({ time: start + index * DAY, value: 0, count: 0 }));
  const selected: TreasuryActivity[] = [];
  let previous = 0;
  let largest = 0;
  let excluded = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const time = Date.parse(row.created_at);
    const value = activityAmount(row, currency);
    if (!Number.isFinite(time) || time > now) continue;
    if (value === null) {
      if (time >= start && time < end && completed.has(row.state.toLowerCase()) &&
        [row.source, row.destination].some(leg => leg.currency.toUpperCase() === currency)) excluded++;
      continue;
    }
    if (time >= start && time < end) {
      const day = days[Math.floor((time - start) / DAY)];
      day.value += value;
      day.count++;
      selected.push(row);
      largest = Math.max(largest, value);
    } else if (time >= start - VOLUME_PERIODS[period] * DAY && time < start) previous += value;
  }
  return { days, rows: selected, total: days.reduce((sum, day) => sum + day.value, 0), previous, largest, excluded };
}
