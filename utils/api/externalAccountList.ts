/**
 * Accept Bridge's paginated list envelope and the canonical BorderPay edge
 * envelope. This also keeps previously deployed mobile bundles compatible
 * while the edge function moves to one stable response contract.
 */
export function extractExternalAccountList(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const value = payload as Record<string, any>;
  if (Array.isArray(value.external_accounts)) return value.external_accounts;
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') {
    if (Array.isArray(value.data.external_accounts)) return value.data.external_accounts;
    if (Array.isArray(value.data.data)) return value.data.data;
  }
  return [];
}
