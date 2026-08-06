// webauthn-auth-verify — verify a client-side authentication assertion.
//
// Loads the stored credential by credential_id, runs server-side
// verification, bumps the counter (monotonic), and marks the challenge
// consumed. A counter regression indicates a cloned authenticator and is
// surfaced as 'counter_regression' so the client can prompt re-enroll.
//
// NOTE (v10 input shape): @simplewebauthn/server@10 expects the stored
// credential under `authenticator: { credentialID, credentialPublicKey,
// counter, transports }`. (The `credential: { id, publicKey }` shape only
// exists in v11+.) Passing the v11 shape under the pinned v10 runtime makes
// the authenticator undefined inside verify → throw. This file passes the
// correct v10 `authenticator` object.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyAuthenticationResponse } from "https://esm.sh/@simplewebauthn/server@10.0.0";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RP_ID  = Deno.env.get('WEBAUTHN_RP_ID') || 'app.borderpayafrica.com';
const ORIGIN = Deno.env.get('WEBAUTHN_ORIGIN') || 'https://app.borderpayafrica.com';

function b64ToBytes(b64) {
  // base64 (not base64url) decoder — matches the standard-base64 encoding
  // webauthn-register-verify uses when persisting public_key.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'POST only' }, 405);

  const supa = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user }, error: authError } = await supa.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: 'Unauthorized' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const { response } = body || {};
  if (!response || !response.id) return json({ success: false, error: 'Missing assertion response' }, 400);

  // Look up the active challenge issued by webauthn-auth-options.
  const { data: chal } = await supa
    .from('webauthn_challenges')
    .select('id, challenge, expires_at')
    .eq('user_id', user.id)
    .eq('purpose', 'authenticate')
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!chal) return json({ success: false, error: 'No active challenge', code: 'no_challenge' }, 410);

  // Find the stored credential.
  const { data: cred } = await supa
    .from('webauthn_credentials')
    .select('id, credential_id, public_key, counter, transports')
    .eq('user_id', user.id)
    .eq('credential_id', response.id)
    .maybeSingle();
  if (!cred) return json({ success: false, error: 'Unknown credential', code: 'no_credentials' }, 404);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin:    ORIGIN,
      expectedRPID:      RP_ID,
      // v10 shape: `authenticator`, with credentialID / credentialPublicKey.
      authenticator: {
        credentialID:        cred.credential_id,
        credentialPublicKey: b64ToBytes(cred.public_key),
        counter:             Number(cred.counter) || 0,
        transports:          cred.transports || ['internal'],
      },
      requireUserVerification: true,
    });
  } catch (e) {
    return json({ success: false, error: `Verification failed: ${e.message}` }, 400);
  }

  if (!verification.verified) {
    return json({ success: false, error: 'Authentication not verified' }, 400);
  }

  const newCounter = verification.authenticationInfo?.newCounter;
  if (typeof newCounter === 'number' && newCounter < (Number(cred.counter) || 0)) {
    return json({
      success: false,
      error:   'Authenticator counter regression — possible cloned device',
      code:    'counter_regression',
    }, 409);
  }

  await supa.from('webauthn_credentials')
    .update({
      counter:      newCounter ?? cred.counter,
      last_used_at: new Date().toISOString(),
    }).eq('id', cred.id);

  await supa.from('webauthn_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', chal.id);

  return json({ success: true });
});
