export type FeeOverride = { user_id: string; virtual_account_id: string; customer_id: string; currency: string; original_fee: number; reward_fee: number; status: string; provider_request_id?: string | null };
export type LiveVa = { id: string; currency: string; fee: number; status: string };
export interface RewardIO {
  read(id: string): Promise<LiveVa>;
  update(id: string, fee: number): Promise<{ requestId: string | null }>;
  save(row: FeeOverride): Promise<void>;
}
export function rewardWanted(eligible: boolean, windows: any[], now = Date.now()): boolean {
  return eligible && windows.some(d => d.status === 'pending_provider' ||
    (['active', 'scheduled'].includes(d.status) && Date.parse(d.starts_at) <= now && Date.parse(d.ends_at) > now));
}
/** Never raise a lower fee or overwrite a separate pricing change. Read back every provider mutation. */
export async function syncVirtualAccountFee(io: RewardIO, input: {
  userId: string; customerId: string; va: LiveVa; prior?: FeeOverride; apply: boolean;
}): Promise<void> {
  const { va, apply } = input;
  if (!['USD', 'EUR', 'GBP'].includes(va.currency)) throw new Error('unsupported_va_currency');
  if (!Number.isFinite(va.fee) || va.fee < 0 || va.fee > 100) throw new Error('provider_fee_unavailable');
  let row = input.prior;
  if (apply && (!row || row.status === 'restored')) {
    if (va.fee <= 2.5) return;
    row = { user_id: input.userId, customer_id: input.customerId, virtual_account_id: va.id,
      currency: va.currency, original_fee: va.fee, reward_fee: 2.5, status: 'apply_pending' };
    await io.save(row); // Durable recovery state before any provider mutation.
  }
  if (!row || (!apply && row.status === 'restored')) return;
  if (row.customer_id !== input.customerId || row.user_id !== input.userId || row.virtual_account_id !== va.id) throw new Error('fee_override_owner_mismatch');
  if (row.status === 'conflict') throw new Error('provider_fee_changed_outside_reward');
  const target = apply ? Number(row.reward_fee) : Number(row.original_fee);
  if (![Number(row.original_fee), Number(row.reward_fee)].includes(va.fee)) {
    await io.save({ ...row, status: 'conflict' });
    throw new Error('provider_fee_changed_outside_reward');
  }
  if (va.fee !== target) {
    await io.save({ ...row, status: apply ? 'apply_pending' : 'restore_pending' });
    const result = await io.update(va.id, target);
    const confirmed = await io.read(va.id);
    if (confirmed.id !== va.id || confirmed.currency !== va.currency || confirmed.fee !== target) throw new Error('provider_fee_confirmation_failed');
    row = { ...row, provider_request_id: result.requestId };
  }
  await io.save({ ...row, status: apply ? 'applied' : 'restored' });
}
