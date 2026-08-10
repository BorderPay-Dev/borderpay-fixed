import type { AfricanPolicyRow } from '../africanRailsPolicyCache';
import { AFRICAN_RAIL_MARKUP_DEFAULT_PERCENT } from './schedule';

export type YellowCardCustomerFee = {
  providerAmount: number;
  borderPayAmount: number;
  customerAmount: number;
  customerPercent: number | null;
  customerFixed: number | null;
  customerMinimum: number | null;
  customerMaximum: number | null;
  effectivePercent: number;
  range: string | null;
};

const finiteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function rangeMatches(range: unknown, amount: number): boolean {
  const normalized = String(range || '').replace(/,/g, '').replace(/ /g, '');
  if (!normalized) return true;
  const band = normalized.match(/^([0-9.]+)-([0-9.]+)(?:[A-Za-z]+)?$/);
  if (band) return amount >= Number(band[1]) && amount <= Number(band[2]);
  const comparison = normalized.match(/^(<=|>=|<|>)([0-9.]+)(?:[A-Za-z]+)?$/);
  if (!comparison) return false;
  const limit = Number(comparison[2]);
  if (comparison[1] === '<=') return amount <= limit;
  if (comparison[1] === '>=') return amount >= limit;
  if (comparison[1] === '<') return amount < limit;
  return amount > limit;
}

const clamp = (value: number, minimum: number | null, maximum: number | null) =>
  Math.max(minimum ?? 0, maximum === null ? value : Math.min(maximum, value));

export function calculateYellowCardCustomerFee(
  row: AfricanPolicyRow | null | undefined,
  amount: number,
): YellowCardCustomerFee | null {
  if (!row || !Number.isFinite(amount) || amount <= 0) return null;
  const raw = row.raw || {};
  const rules = Array.isArray(raw.pricing_rules) ? raw.pricing_rules as Array<Record<string, unknown>> : [];
  const selected = rules.length > 0 ? [...rules].reverse().find((rule) => rangeMatches(rule.range, amount)) : null;
  if (rules.length > 0 && !selected) return null;
  const providerPercent = finiteNumber(selected ? selected.fee_percent : raw.provider_fee_percent);
  const providerFixed = finiteNumber(selected ? selected.fee_local : raw.provider_fee_local);
  const providerMinimum = finiteNumber(selected ? selected.minimum_fee_local : raw.minimum_fee_local);
  const providerMaximum = finiteNumber(selected ? selected.maximum_fee_local : raw.maximum_fee_local);
  const customerPercent = providerPercent === null ? null : providerPercent + AFRICAN_RAIL_MARKUP_DEFAULT_PERCENT;
  const customerFixed = providerFixed === null ? null : providerFixed * 2;
  const customerMinimum = providerMinimum === null ? null : providerMinimum * 2;
  const customerMaximum = providerMaximum === null ? null : providerMaximum * 2;

  const providerAmount = providerFixed !== null
    ? providerFixed
    : providerPercent !== null
      ? clamp((amount * providerPercent) / 100, providerMinimum, providerMaximum)
      : providerMinimum ?? 0;
  const customerAmount = customerFixed !== null
    ? customerFixed
    : customerPercent !== null
      ? clamp((amount * customerPercent) / 100, customerMinimum, customerMaximum)
      : customerMinimum ?? (amount * AFRICAN_RAIL_MARKUP_DEFAULT_PERCENT) / 100;

  return {
    providerAmount,
    borderPayAmount: Math.max(0, customerAmount - providerAmount),
    customerAmount,
    customerPercent,
    customerFixed,
    customerMinimum,
    customerMaximum,
    effectivePercent: (customerAmount / amount) * 100,
    range: selected?.range ? String(selected.range) : null,
  };
}
