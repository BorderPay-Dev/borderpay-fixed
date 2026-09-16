import { assertEquals, assert } from 'jsr:@std/assert';
import { friendlyError } from '../utils/errors/friendlyError.ts';
import { bridgeTransferUiState, normalizeLegacyBridgeAcceptance, isBridgeTransferUnconfirmed } from '../utils/financial/bridgeTransferOutcome.ts';

Deno.test('authentication failures never become KYC instructions; genuine KYC remains actionable', () => {
  for (const error of ['Strong authentication could not be verified. Nothing was changed.',
    { code: 'sca_scope_unavailable', error: 'Your account is not verified.' },
    { code: 'sca_invalid', error: 'not_verified' }, { code: 'balance_check_unavailable', error: 'not_verified' }]) {
    assert(!friendlyError(error).includes('Verify your ID'));
  }
  assert(friendlyError({ code: 'kyc_not_approved' }).includes('Identity verification required'));
});

Deno.test('lost responses remain unconfirmed without masking explicit rejection or claiming acceptance', () => {
  for (const code of ['response_unconfirmed', 'transfer_status_unavailable']) {
    const result = { success: false, code };
    assert(isBridgeTransferUnconfirmed(result));
    assertEquals(normalizeLegacyBridgeAcceptance(result).success, false);
  }
  for (const code of ['insufficient_balance', 'kyc_not_approved', 'sca_invalid', 'transfer_failed']) {
    assertEquals(isBridgeTransferUnconfirmed({ success: false, code }), false);
  }
});
Deno.test('only explicit accepted-transfer evidence converts an old failure to pending', () => {
  const id = '80fa5fb8-b51a-4263-aab6-7e9f67c19a3e';
  const result = normalizeLegacyBridgeAcceptance({ success: false, code: 'persistence_failed', bridge_transfer_id: id });
  assertEquals(result.success, true); assertEquals(result.data.transfer_id, id);
  assertEquals(bridgeTransferUiState(result.data), 'pending');
  for (const body of [{ success: false, code: 'response_unconfirmed' },
    { success: false, code: 'persistence_failed' }, { success: false, code: 'sca_required', bridge_transfer_id: id }]) {
    assertEquals(normalizeLegacyBridgeAcceptance(body), body);
  }
  assertEquals(bridgeTransferUiState({ state: 'succeeded' }), 'completed');
  assertEquals(bridgeTransferUiState({ provider_state: 'payment_submitted' }), 'pending');
  assertEquals(bridgeTransferUiState({ state: 'failed' }), 'failed');
  assertEquals(bridgeTransferUiState({ provider_state: 'new_provider_state' }), 'pending');
});
