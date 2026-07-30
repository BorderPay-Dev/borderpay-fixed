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
  title?: string | null;
  body?: string | null;
  message?: string | null;
  description?: string | null;
  amount?: number | string | null;
  metadata?: any;
}

export function txDirection(tx: TxLike): TxDirection {
  const metadata = tx?.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
  const md = String(metadata.direction || metadata.balance_impact || '').trim().toLowerCase();
  if (md === 'credit' || md === 'debit') return md;

  const amt = typeof tx?.amount === 'string' ? parseFloat(tx.amount) : tx?.amount;
  if (typeof amt === 'number' && Number.isFinite(amt) && amt < 0) return 'debit';

  const t = String(
    tx?.type ||
    metadata.transaction_type ||
    metadata.kind ||
    metadata.flow ||
    '',
  ).trim().toLowerCase();
  if (CREDIT_TYPES.has(t) || ['credit', 'collection', 'virtual_account_deposit_status', 'wallet_credit'].includes(t)) return 'credit';
  if (DEBIT_TYPES.has(t) || ['debit', 'send', 'payout', 'wallet_debit', 'bridge_transfer'].includes(t)) return 'debit';

  const sourceType = String(metadata.source_type || metadata.source?.type || metadata.source?.payment_rail || '').toLowerCase();
  const destinationType = String(metadata.destination_type || metadata.destination?.type || metadata.destination?.payment_rail || '').toLowerCase();
  if (sourceType === 'wallet' || sourceType === 'bridge_wallet') return 'debit';
  if (destinationType === 'wallet' || destinationType === 'bridge_wallet') return 'credit';

  const text = [
    tx?.title,
    tx?.body,
    tx?.message,
    tx?.description,
    metadata.title,
    metadata.description,
    metadata.reason,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  if (/\b(sent|send|debit|withdraw|withdrawal|payout|paid out|money out|transfer out|outgoing)\b/.test(text)) return 'debit';
  if (/\b(received|receive|credit|deposit|collection|money in|incoming)\b/.test(text)) return 'credit';

  return 'debit';
}

export const isCredit = (tx: TxLike): boolean => txDirection(tx) === 'credit';
