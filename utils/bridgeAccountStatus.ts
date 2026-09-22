export interface BridgeAccountStatusLike {
  account_status?: string | null;
  bridge_account_status?: string | null;
  bridge_account_paused_at?: string | null;
  bridge_provider_account_status?: string | null;
  account_frozen_at?: string | null;
}

const normalizeStatus = (value: unknown) => String(value ?? '').trim().toLowerCase();

const BLOCKED_ACCOUNT_STATUSES = new Set(['frozen', 'paused', 'suspended', 'offboarded', 'deactivated', 'closed']);

/** Bridge `paused` is an access hold, not a KYC rejection. */
export function isBridgeAccountPaused(profile: BridgeAccountStatusLike | null | undefined): boolean {
  return BLOCKED_ACCOUNT_STATUSES.has(normalizeStatus(profile?.account_status)) ||
    BLOCKED_ACCOUNT_STATUSES.has(normalizeStatus(profile?.bridge_account_status));
}

export function formatBridgePausedDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/** Only an explicitly reported provider pause gets a limited workspace.
 * Legacy compatibility 'paused' can represent closed/frozen accounts, so it
 * must not unlock navigation without the raw provider status. */
export function isReceivingOnlyPause(profile: BridgeAccountStatusLike | null | undefined): boolean {
  return normalizeStatus(profile?.bridge_provider_account_status) === 'paused'
    && ['active', 'approved', 'pending_kyc'].includes(normalizeStatus(profile?.account_status))
    && !profile?.account_frozen_at;
}
