// webauthn-delete — remove the authenticated user's WebAuthn credential(s).
//
// Why this exists: "Disable Biometric" must delete the SERVER credential, not
// just the local hint. webauthn-register-options builds excludeCredentials from
// webauthn_credentials, so a leftover row makes the platform authenticator
// refuse a re-enroll on the same device with InvalidStateError. Deleting the
// row(s) here lets the user cleanly disable then re-enable.
//
// Body (optional): { credential_id?: string }
//   • credential_id present → delete just that credential (must belong to the
//     caller).
//   • omitted → delete ALL of the caller's credentials (full disable).
//
// Auth: verify_jwt = true; the caller is identified from the bearer token and
// can only ever delete their OWN rows (user_id = auth.uid()).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { consumeScaAuthorization } from "../_shared/sca.ts";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'POST only' }, 405);

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user }, error: authError } = await supa.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: 'Unauthorized' }, 401);

  let body = {};
  try { body = await req.json(); } catch { /* empty body allowed → delete all */ }
  const credentialId = (body as any)?.credential_id;

  const sca = await consumeScaAuthorization({
    supabase: supa,
    authorizationId: (body as any)?.sca_authorization_id,
    userId: user.id,
    operation: 'security_change',
    resource: 'biometric_change',
    request: { action: 'disable_biometric', ...(credentialId ? { credential_id: String(credentialId) } : {}) },
  });
  if (!sca.ok) return json(sca.body, sca.status);

  // Always scope to the caller's own rows; credential_id only narrows further.
  let q = supa.from('webauthn_credentials').delete().eq('user_id', user.id);
  if (credentialId) q = q.eq('credential_id', String(credentialId));

  const { data: deleted, error } = await q.select('id');
  if (error) return json({ success: false, error: error.message }, 500);

  return json({ success: true, deleted_count: (deleted || []).length });
});
