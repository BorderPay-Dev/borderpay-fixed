// webauthn-auth-options — server-issued authentication challenge.
//
// Returns PublicKeyCredentialRequestOptions for navigator.credentials.get().
// Lists this user's enrolled credentials so the browser can pick the right
// one. Stores the challenge with 5-minute TTL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { generateAuthenticationOptions } from "https://esm.sh/@simplewebauthn/server@10.0.0";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RP_ID = Deno.env.get('WEBAUTHN_RP_ID') || 'app.borderpayafrica.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supa = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user }, error: authError } = await supa.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: 'Unauthorized' }, 401);

  const { data: creds } = await supa
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  if (!creds || creds.length === 0) {
    return json({ success: false, error: 'No biometric enrolled', code: 'no_credentials' }, 400);
  }

  const allowCredentials = creds.map((c) => ({
    id:         c.credential_id,
    type:       'public-key',
    transports: c.transports || ['internal'],
  }));

  const options = await generateAuthenticationOptions({
    rpID:                     RP_ID,
    allowCredentials,
    userVerification:         'required',
    timeout:                  60_000,
  });

  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { error } = await supa.from('webauthn_challenges').insert({
    user_id:    user.id,
    challenge:  options.challenge,
    purpose:    'authenticate',
    rp_id:      RP_ID,
    expires_at: expiresAt,
  });
  if (error) return json({ success: false, error: error.message }, 500);

  return json({ success: true, data: { options, rp_id: RP_ID } });
});
