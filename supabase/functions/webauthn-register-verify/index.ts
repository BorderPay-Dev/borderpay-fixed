// webauthn-register-verify — verify a client-side registration assertion
// and persist the new credential.
//
// Consumes the matching challenge row, verifies the attestation server-side
// via @simplewebauthn/server, then writes credential_id + public_key +
// counter into webauthn_credentials. Single-use challenge: marked consumed.
//
// NOTE (v10 result shape): @simplewebauthn/server@10 returns the registration
// result FLAT on `registrationInfo` — credentialID (Base64URLString),
// credentialPublicKey (Uint8Array), counter, credentialDeviceType,
// credentialBackedUp. (The nested `registrationInfo.credential.{id,publicKey}`
// shape only exists in v11+.) Reading the v11 shape under the pinned v10
// runtime made `credential` undefined → `credential.id` threw → uncaught 500,
// so nothing was written and the challenge was never consumed. This file reads
// the correct v10 fields.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyRegistrationResponse } from "https://esm.sh/@simplewebauthn/server@10.0.0";

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RP_ID  = Deno.env.get('WEBAUTHN_RP_ID') || 'app.borderpayafrica.com';
const ORIGIN = Deno.env.get('WEBAUTHN_ORIGIN') || 'https://app.borderpayafrica.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'POST only' }, 405);

  const supa = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: { user }, error: authError } = await supa.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: 'Unauthorized' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const { response, nickname } = body || {};
  if (!response) return json({ success: false, error: 'Missing response' }, 400);

  // Look up the most recent un-consumed register challenge for this user.
  const { data: chal } = await supa
    .from('webauthn_challenges')
    .select('id, challenge, expires_at')
    .eq('user_id', user.id)
    .eq('purpose', 'register')
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!chal) return json({ success: false, error: 'No active challenge (expired or already used)' }, 410);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: chal.challenge,
      expectedOrigin:    ORIGIN,
      expectedRPID:      RP_ID,
      requireUserVerification: true,
    });
  } catch (e) {
    return json({ success: false, error: `Verification failed: ${e.message}` }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ success: false, error: 'Registration not verified' }, 400);
  }

  // v10 shape: fields live directly on registrationInfo.
  const {
    credentialID,            // Base64URLString — store as-is
    credentialPublicKey,     // Uint8Array
    counter,                 // number
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo;

  // Standard-base64 encode the public key. webauthn-auth-verify decodes it with
  // atob() (standard base64), so the two MUST stay consistent.
  const pubKeyB64  = btoa(String.fromCharCode(...new Uint8Array(credentialPublicKey)));
  const transports = (response.response?.transports as string[] | undefined) || ['internal'];

  const { error: insErr } = await supa.from('webauthn_credentials').insert({
    user_id:       user.id,
    credential_id: credentialID,
    public_key:    pubKeyB64,
    counter:       counter ?? 0,
    transports,
    device_type:   credentialDeviceType ?? null,
    backed_up:     credentialBackedUp ?? false,
    nickname:      nickname || 'Platform authenticator',
  });
  if (insErr) return json({ success: false, error: insErr.message }, 500);

  await supa.from('webauthn_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', chal.id);

  return json({ success: true });
});
