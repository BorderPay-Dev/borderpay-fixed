export interface BridgeAccountStatusLike {
  bridge_account_status?: string | null;
  bridge_account_paused_at?: string | null;
  account_status?: string | null;
  account_frozen_at?: string | null;
  account_frozen_reason?: string | null;
}

const normalizeStatus = (value: unknown) => String(value ?? '').trim().toLowerCase();

/** Bridge `paused` is an access hold, not a KYC rejection. */
export function isBridgeAccountPaused(profile: BridgeAccountStatusLike | null | undefined): boolean {
  return normalizeStatus(profile?.bridge_account_status) === 'paused' || normalizeStatus(profile?.account_status) === 'frozen';
}

export function formatBridgePausedDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit', timeZone: 'UTC',
  }).format(date);
}
