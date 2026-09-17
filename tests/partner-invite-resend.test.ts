import { resendPartnerInvitation } from '../supabase/functions/_shared/partner-invite-resend.ts';
const now = new Date('2026-09-17T01:00:00Z');
const original = '2026-09-15T09:20:37Z';
function fake(status = 'invited', organization = false) {
  const row: any = { id: 2, email: 'info@example.com', status, invited_at: original, accepted_at: status === 'accepted' ? original : null };
  const db = { from(table: string) {
    let update: any; const filters: Array<[string, unknown]> = [];
    const q: any = {
      select() { return q; }, update(value: any) { update = value; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      is(k: string, v: unknown) { filters.push([k, v]); return q; },
      ilike() { return q; }, limit() { return q; },
      async maybeSingle() {
        if (table === 'partner_organizations') return { data: organization ? { id: 'org' } : null, error: null };
        if (!filters.every(([k, v]) => row[k] === v)) return { data: null, error: null };
        if (update) Object.assign(row, update);
        return { data: { ...row }, error: null };
      },
      then(resolve: any, reject: any) { return q.maybeSingle().then(resolve, reject); },
    }; return q;
  } }; return { db, row };
}
function assert(value: unknown) { if (!value) throw new Error('Assertion failed'); }
Deno.test('resend delivers only to the stored email and preserves approval state', async () => {
  const { db, row } = fake(); let sent = 0;
  const result = await resendPartnerInvitation(db, 2, async (email, id) => { assert(email === row.email && id === 2); sent++; }, now);
  assert(result.status === 200 && sent === 1 && row.status === 'invited' && row.accepted_at === null);
});
Deno.test('accepted, rejected, pending and existing workspace invitations cannot be resent', async () => {
  for (const [state, org] of [['accepted', false], ['rejected', false], ['pending', false], ['invited', true]] as const) {
    const { db } = fake(state, org);
    const r = await resendPartnerInvitation(db, 2, async () => { throw new Error('Must not send'); }, now);
    assert(r.status === 409);
  }
});
Deno.test('concurrent resends send only one email and subsequent calls are throttled', async () => {
  const { db } = fake(); let sent = 0;
  const send = async () => { sent++; };
  const results = await Promise.all([resendPartnerInvitation(db, 2, send, now), resendPartnerInvitation(db, 2, send, now)]);
  assert(sent === 1 && results.filter(r => r.status === 200).length === 1);
  assert((await resendPartnerInvitation(db, 2, send, now)).status === 429 && sent === 1);
});
Deno.test('failed delivery restores timestamp and keeps invitation eligible', async () => {
  const { db, row } = fake();
  const r = await resendPartnerInvitation(db, 2, async () => { throw new Error('Mail unavailable'); }, now);
  assert(r.status === 502 && row.invited_at === original && row.status === 'invited');
});
Deno.test('invalid or missing request does not send', async () => {
  const { db } = fake(); const send = async () => { throw new Error('Must not send'); };
  assert((await resendPartnerInvitation(db, NaN, send, now)).status === 400);
  assert((await resendPartnerInvitation(db, 99, send, now)).status === 404);
});
