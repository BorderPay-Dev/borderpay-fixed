import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { syncApprovedBridgeAccountStatus } from '../supabase/functions/_shared/bridge-approved-account-status.ts';

function database(type = 'individual') {
  const profile: any = { id: 'owner', account_type: type, account_status: 'pending_kyc', account_frozen_at: null,
    bridge_customer_id: 'customer', bridge_account_status: 'active', bridge_kyc_status: 'approved', kyc_status: 'verified' };
  const business = { user_id: 'owner', bridge_customer_id: 'customer', bridge_kyb_status: 'approved' };
  const state = { profile, business, beforeWrite: () => {}, fail: false };
  return { state, from(table: string) {
    const filters: Record<string, unknown> = {}; let patch: any = null;
    const query: any = {
      select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      is(key: string, value: unknown) { filters[key] = value; return query; },
      maybeSingle() { return Promise.resolve({ data: { ...(table === 'user_profiles' ? profile : business) }, error: state.fail ? {} : null }); },
      update(value: unknown) { patch = value; return query; },
      then(resolve: (value: unknown) => void) {
        state.beforeWrite();
        if (Object.entries(filters).every(([key, value]) => profile[key] === value)) Object.assign(profile, patch);
        resolve({ error: null });
      },
    }; return query;
  } };
}
Deno.test('approved active individuals and businesses leave only the stale pending KYC state', async () => {
  for (const type of ['individual', 'business']) {
    const db = database(type);
    await syncApprovedBridgeAccountStatus(db, 'owner', 'customer');
    assertEquals(db.state.profile.account_status, 'active');
  }
});
Deno.test('approval sync preserves locked, incomplete, and mismatched accounts', async () => {
  for (const status of ['frozen', 'paused', 'suspended', 'rejected', 'closed', 'active']) {
    const db = database(); db.state.profile.account_status = status;
    await syncApprovedBridgeAccountStatus(db, 'owner', 'customer');
    assertEquals(db.state.profile.account_status, status);
  }
  for (const patch of [{ bridge_account_status: 'paused' }, { bridge_kyc_status: 'incomplete' },
    { account_frozen_at: '2026-09-16' }, { bridge_customer_id: 'other' }]) {
    const db = database(); Object.assign(db.state.profile, patch);
    await syncApprovedBridgeAccountStatus(db, 'owner', 'customer');
    assertEquals(db.state.profile.account_status, 'pending_kyc');
  }
  const db = database('business'); db.state.business.bridge_kyb_status = 'rejected';
  await syncApprovedBridgeAccountStatus(db, 'owner', 'customer');
  assertEquals(db.state.profile.account_status, 'pending_kyc');
});
Deno.test('concurrent freeze wins over an earlier approval read; lookup failures surface for retry', async () => {
  const db = database(); db.state.beforeWrite = () => { db.state.profile.account_status = 'frozen'; };
  await syncApprovedBridgeAccountStatus(db, 'owner', 'customer');
  assertEquals(db.state.profile.account_status, 'frozen');
  db.state.fail = true;
  await assertRejects(() => syncApprovedBridgeAccountStatus(db, 'owner', 'customer'));
});
