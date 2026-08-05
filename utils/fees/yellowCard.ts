type FeeScheduleRow = {
  currency?: unknown;
  provider_fee_percent?: unknown;
  provider_fee_fixed?: unknown;
  borderpay_markup_percent?: unknown;
  borderpay_markup_fixed?: unknown;
  min_total?: unknown;
  max_total?: unknown;
};

const finite = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function yellowCardCustomerFee(raw: Record<string, unknown> | null | undefined, amount: number) {
  if (!raw || !Number.isFinite(amount) || amount <= 0) return null;
  const schedules = Array.isArray(raw.customer_fee_schedule)
    ? raw.customer_fee_schedule as FeeScheduleRow[]
    : [];
  const row = schedules.find((candidate) => {
    const minimum = finite(candidate.min_total, 0);
    const maximum = candidate.max_total === null || candidate.max_total === undefined
      ? Number.POSITIVE_INFINITY
      : finite(candidate.max_total, Number.POSITIVE_INFINITY);
    return amount >= minimum && amount <= maximum;
  });
  if (!row) return null;
  const providerPercent = finite(row.provider_fee_percent);
  const providerFixed = finite(row.provider_fee_fixed);
  const markupPercent = finite(row.borderpay_markup_percent);
  const markupFixed = finite(row.borderpay_markup_fixed);
  const percent = providerPercent + markupPercent;
  const fixed = providerFixed + markupFixed;
  return {
    amount: (amount * percent) / 100 + fixed,
    currency: String(row.currency || '').toUpperCase(),
    percent,
    fixed,
    providerPercent,
    markupPercent,
    source: 'fee_schedule' as const,
  };
}
