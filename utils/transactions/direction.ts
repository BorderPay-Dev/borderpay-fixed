/**
 * Transaction direction — single source of truth for whether a transaction is a
 * CREDIT (money in, balance ↑) or DEBIT (money out, balance ↓).
 *
 * The DB `transaction_type` enum is deposit / withdrawal / transfer / exchange /
 * fee / refund / card_funding / card_withdrawal / mobile_money / stablecoin —
 * NOT credit/debit. UI and the treasury chart need a direction, so derive it:
 *   1. explicit `metadata.direction` ('credit' | 'debit') wins,
 *   2. else a signed `amount` (< 0 → debit),
 *   3. else map by type, defaulting ambiguous transfer-like types to debit.
 */

export type TxDirection = 'credit' | 'debit';

const CREDIT_TYPES = new Set(['deposit', 'refund', 'card_withdrawal']);
const DEBIT_TYPES  = new Set(['withdrawal', 'fee', 'card_funding']);

export interface TxLike {
  type?: string | null;
  amount?: number | string | null;
  metadata?: any;
}

export function txDirection(tx: TxLike): TxDirection {
  const md = tx?.metadata?.direction;
  if (md === 'credit' || md === 'debit') return md;

  const amt = typeof tx?.amount === 'string' ? parseFloat(tx.amount) : tx?.amount;
  if (typeof amt === 'number' && Number.isFinite(amt) && amt < 0) return 'debit';

  const t = String(tx?.type || '').toLowerCase();
  if (CREDIT_TYPES.has(t)) return 'credit';
  if (DEBIT_TYPES.has(t)) return 'debit';
  return 'debit';
}

export const isCredit = (tx: TxLike): boolean => txDirection(tx) === 'credit';
