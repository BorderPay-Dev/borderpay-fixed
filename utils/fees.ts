/**
 * BorderPay Africa — Fee Calculator
 * Reads live fee schedule from fee_config table in Supabase.
 * Never exposes provider_cost or bp_revenue to the user — only user_pays.
 */

import { supabase } from './supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeeResult {
  user_pays: number;
  currency: string;
  breakdown: string;      // e.g. "3.5%" or "50 NGN"
  fee_type: 'flat' | 'percentage';
  zero_fee: boolean;
}

// ── Transfer limits per corridor + channel ────────────────────────────────────

interface Limit { min: number; max: number }

export const TRANSFER_LIMITS: Record<string, Limit> = {
  XAF:       { min: 500,    max: 500_000   },
  KES_mobile:{ min: 80,     max: 250_000   },
  KES_bank:  { min: 100,    max: 950_000   },
  GHS_mobile:{ min: 10,     max: 15_000    },
  GHS_bank:  { min: 10,     max: 200_000   },
  XOF:       { min: 100,    max: 2_000_000 },
  UGX:       { min: 500,    max: 5_000_000 },
  TZS:       { min: 1_500,  max: 4_000_000 },
};

/** Return the limits key for a given currency+channel combination */
export function getLimitKey(currency: string, channel: 'bank' | 'mobile_money'): string | null {
  if (currency === 'KES') return channel === 'bank' ? 'KES_bank' : 'KES_mobile';
  if (currency === 'GHS') return channel === 'bank' ? 'GHS_bank' : 'GHS_mobile';
  const direct = ['XAF', 'XOF', 'UGX', 'TZS'];
  if (direct.includes(currency)) return currency;
  return null; // NGN has no enforced limit in this table
}

/** Validate amount against transfer limits. Returns an error string or null. */
export function validateTransferAmount(
  amount: number,
  currency: string,
  channel: 'bank' | 'mobile_money',
  currencySymbol: string
): string | null {
  const key = getLimitKey(currency, channel);
  if (!key) return null;
  const lim = TRANSFER_LIMITS[key];
  if (!lim) return null;
  if (amount < lim.min) {
    return `Minimum transfer is ${currencySymbol}${lim.min.toLocaleString()}.`;
  }
  if (amount > lim.max) {
    return `Maximum transfer is ${currencySymbol}${lim.max.toLocaleString()}.`;
  }
  return null;
}

// ── Core fee fetch ────────────────────────────────────────────────────────────

/**
 * Fetch a fee row from fee_config and calculate the fee for `amount`.
 * Queries by corridor + channel + category (default PAYOUT).
 */
export async function getFeeByCorridorChannel(
  corridor: string,
  channel: string,
  amount: number,
  category = 'PAYOUT'
): Promise<FeeResult | null> {
  const { data, error } = await supabase
    .from('fee_config')
    .select('*')
    .eq('corridor', corridor)
    .eq('channel', channel)
    .eq('category', category)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (error || !data) return null;
  return calcFee(data, amount);
}

/**
 * Fetch a fee row by exact transaction_type name.
 */
export async function getFeeByType(
  transactionType: string,
  amount: number
): Promise<FeeResult | null> {
  const { data, error } = await supabase
    .from('fee_config')
    .select('*')
    .eq('transaction_type', transactionType)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (error || !data) return null;
  return calcFee(data, amount);
}

// ── Card funding fee ──────────────────────────────────────────────────────────

/**
 * Returns the card funding fee for a given USD amount.
 * Uses "Card Funding (under $100)" or "Card Funding (over $100)".
 */
export async function getCardFundingFee(amount: number): Promise<FeeResult | null> {
  const transactionType = amount < 100
    ? 'Card Funding (under $100)'
    : 'Card Funding (over $100)';
  return getFeeByType(transactionType, amount);
}

// ── Transfer fee (maps method+currency → correct fee_config row) ──────────────

/**
 * Returns the payout fee for a transfer.
 * method: 'bank' | 'mobile_money'
 */
export async function getTransferFee(
  method: 'bank' | 'mobile_money' | 'borderpay' | 'us_ach_wire' | 'stablecoin',
  currency: string,
  amount: number
): Promise<FeeResult | null> {
  if (method === 'borderpay' || method === 'us_ach_wire' || method === 'stablecoin') {
    return null; // no fee_config entries for these — fee included in rate
  }
  const channel = method === 'mobile_money' ? 'mobile_money' : 'bank_transfer';
  return getFeeByCorridorChannel(currency, channel, amount, 'PAYOUT');
}

// ── Internal calculator ───────────────────────────────────────────────────────

function calcFee(data: any, amount: number): FeeResult {
  const val = parseFloat(data.user_pays_value) || 0;
  let userPays: number;

  if (data.user_pays_type === 'percentage') {
    userPays = (amount * val) / 100;
    if (data.user_pays_min)  userPays = Math.max(userPays, parseFloat(data.user_pays_min));
    if (data.user_pays_cap)  userPays = Math.min(userPays, parseFloat(data.user_pays_cap));
  } else {
    userPays = val;
  }

  // Legacy column `maplerad_fee_currency` retained as a fallback for existing
  // fee_config rows. New rows should set `fee_currency`. The column itself is
  // not dropped in this pass (audit/history kept intact).
  const currency: string = data.fee_currency || data.maplerad_fee_currency || 'USD';
  const breakdown: string = data.user_pays_type === 'percentage'
    ? `${val}%${data.user_pays_min ? ` (min ${parseFloat(data.user_pays_min).toLocaleString()} ${currency})` : ''}`
    : `${val.toLocaleString()} ${currency}`;

  return {
    user_pays: Math.round(userPays * 100) / 100,
    currency,
    breakdown,
    fee_type: data.user_pays_type as 'flat' | 'percentage',
    zero_fee: userPays === 0,
  };
}
