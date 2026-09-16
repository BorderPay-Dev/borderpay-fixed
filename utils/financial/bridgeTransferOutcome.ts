export function normalizeLegacyBridgeAcceptance(result: any): any {
  // Released backends could return HTTP 500 after accepting the transfer.
  // Only that explicit contract is acceptance evidence; never infer it from
  // arbitrary errors, timeouts, or a request's idempotency key.
  if (result?.success === false && result?.code === 'persistence_failed'
    && typeof result.bridge_transfer_id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.bridge_transfer_id)) {
    return { success: true, code: 'provider_confirmation_pending', data: {
      transfer_id: result.bridge_transfer_id, state: 'pending', reconciliation_pending: true,
    } };
  }
  return result;
}

export function bridgeTransferUiState(data: any): 'pending' | 'completed' | 'failed' {
  const state = String(data?.state || data?.provider_state || '').toLowerCase();
  if (['succeeded', 'completed', 'payment_processed'].includes(state)) return 'completed';
  if (['failed', 'undeliverable', 'returned', 'missing_return_policy', 'refunded', 'refund_failed', 'canceled', 'error'].includes(state)) return 'failed';
  return 'pending';
}
