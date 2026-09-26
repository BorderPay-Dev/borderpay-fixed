// Controlled synthetic pilot. This flag is server-managed app_metadata from getUser,
// never client input or editable user_metadata. Existing customers retain their provider flow.
const KYB_ORIGIN = 'https://kyb.borderpayvelocity.xyz';
export async function kybPortalHandoff(user: { app_metadata?: Record<string, unknown> }, token: string, transport: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  if (user.app_metadata?.kyb_synthetic_test !== true) return null;
  const unavailable = { success: false, code: 'verification_link_unavailable', error: 'We could not open your verification. Please try again shortly.' };
  try {
    const response = await transport(KYB_ORIGIN + '/api/launch', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!response.ok) return unavailable;
    const link = await response.json();
    const url = new URL(link.url);
    if (url.origin !== KYB_ORIGIN || url.pathname !== '/' || url.search || url.username || url.password || !/^#launch=[A-Za-z0-9_-]+$/.test(url.hash)) return unavailable;
    if (!Number.isFinite(Date.parse(link.expiresAt)) || Date.parse(link.expiresAt) <= Date.now()) return unavailable;
    return { success: true, data: { link_url: url.toString(), expires_at: link.expiresAt, tos_link_url: null, tos_required: false, verification_mode: 'synthetic' } };
  } catch { return unavailable; }
}
