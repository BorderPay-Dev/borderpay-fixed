import { loadAndAssertBridgeIdentityInvariant } from './bridge-identity-invariant.ts';
import { resolveBridgeScaScope } from './bridge-sca-scope.ts';

type Database = { from: (table: string) => any };
const unavailable = () => ({
  ok: false as const, status: 503,
  body: { success: false, code: 'sca_scope_unavailable', error: 'Payment authentication scope could not be verified. Nothing was changed.' },
});

/** Legacy/API transfer entrypoints have no request-bound two-factor flow.
 * Only positively identified non-EEA customers may use those entrypoints.
 * The selected funds owner, never the operator/tenant identity, sets scope.
 */
export async function guardUnattestedTransfer(
  db: Database, owner: { userId?: string; customerId?: string; walletId?: string },
) {
  let userId = owner.userId;
  if (!userId && owner.walletId) {
    const { data: wallet, error } = await db.from('bridge_wallets')
      .select('user_id').eq('bridge_wallet_id', owner.walletId).maybeSingle();
    if (error || !wallet?.user_id) return unavailable();
    userId = String(wallet.user_id);
  }
  if (!userId && owner.customerId) {
    const [businesses, profiles] = await Promise.all([
      db.from('business_profiles').select('user_id').eq('bridge_customer_id', owner.customerId).limit(2),
      db.from('user_profiles').select('id').eq('bridge_customer_id', owner.customerId).limit(2),
    ]);
    if (businesses.error || profiles.error) return unavailable();
    const owners = new Set([
      ...(businesses.data || []).map((row: any) => String(row.user_id)),
      ...(profiles.data || []).map((row: any) => String(row.id)),
    ]);
    if (owners.size !== 1) return unavailable();
    userId = [...owners][0] as string;
  }
  if (!userId) return unavailable();
  if (owner.customerId) {
    const identity = await loadAndAssertBridgeIdentityInvariant(db, userId);
    if (!identity.ok || identity.context.bridge_customer_id !== owner.customerId) return unavailable();
  }
  const scope = await resolveBridgeScaScope(db, userId, 'payment');
  if (scope.status === 'not_required' && scope.reason === 'non_eea') return { ok: true as const };
  if (scope.required) return {
    ok: false as const, status: 403,
    body: { success: false, code: 'sca_required', error: 'This payment requires strong authentication. Use the individual payment flow to authorize it.' },
  };
  return unavailable();
}
