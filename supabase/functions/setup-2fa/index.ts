// setup-2fa v85 — server-side TOTP secret + AES-256-GCM encryption at rest,
// via base64 RPC (round-7 P1 fix).
//
// SOURCE OF TRUTH for deployed version 84/85. Earlier vendored versions
// stored the base32 secret in plaintext at user_security.two_factor_secret;
// CTO review correctly flagged that as a false "encrypted at rest" claim,
// and round-7 CTO review then flagged that v84's bytea write path was
// broken: `Array.from(cipher)` round-tripped through PostgREST as the
// ASCII text of `[139,71,...]`, not the actual cipher bytes.
//
// This version:
//
//   • Generates a 160-bit base32 secret (RFC 4226 minimum).
//   • Encrypts with AES-256-GCM under TOTP_ENCRYPTION_KEY (server-only
//     env var; 32-byte base64). Stored format: [12-byte IV] || ciphertext
//     (the GCM 16-byte tag is appended to the ciphertext by crypto.subtle).
//   • Persists ONLY the encrypted bytes via the
//     `set_totp_secret_encrypted_b64` RPC (added in migration
//     20260520_totp_secret_b64_rpcs.sql). The RPC accepts the cipher as a
//     base64 string and decodes to bytea inside Postgres, so the wire
//     format stays text-clean. The RPC also nulls out the legacy
//     plaintext column atomically.
//   • FAILS CLOSED if TOTP_ENCRYPTION_KEY is missing or malformed —
//     returns 500 server_misconfigured. No more silent plaintext fallback.
//
// Returns the plaintext secret to the client EXACTLY ONCE so the
// authenticator app can scan the QR. After that, the secret only exists
// server-side as ciphertext.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function generateBase32Secret(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < length; i++) s += BASE32_CHARS[bytes[i] % 32];
  return s;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importEncKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get('TOTP_ENCRYPTION_KEY');
  if (!raw) return null;
  let keyBytes: Uint8Array;
  try { keyBytes = b64ToBytes(raw); } catch { return null; }
  if (keyBytes.byteLength !== 32) return null;
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encryptSecret(secret: string): Promise<Uint8Array | null> {
  const key = await importEncKey();
  if (!key) return null;
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const pt  = new TextEncoder().encode(secret);
  const ct  = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(ct, iv.byteLength);
  return out;
}

/** Base64-encode bytes for transport to PostgreSQL via the b64 RPC.
 *  We intentionally do NOT use Array.from(cipher) here — that was the
 *  v84 bug that wrote ASCII JSON text into a bytea column. */
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ success: false, error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = auth.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: 'Unauthorized' }, 401);

    // P0 guard: block duplicate enrollment when 2FA is already active.
    // This prevents repeated "add authenticator" loops and multiple secrets
    // per user after enablement.
    {
      const { data: sec } = await supabase
        .from('user_security')
        .select('two_factor_enabled')
        .eq('user_id', user.id)
        .maybeSingle();
      if (sec?.two_factor_enabled === true) {
        return json({
          success: false,
          error: '2FA already enabled',
          code: 'two_factor_already_enabled',
        }, 409);
      }
    }

    const encryptedBytes = await encryptSecret(generateBase32Secret().slice(0, 1));
    // ↑ above intentionally throws away that result; we just use it as a
    //   capability check below so we never generate a real secret without
    //   confirmed encryption capability.
    if (!encryptedBytes) {
      console.error('setup-2fa: TOTP_ENCRYPTION_KEY missing or invalid — failing closed');
      return json({
        success: false,
        error:   'Two-factor setup is temporarily unavailable. Please try again shortly.',
        code:    'server_misconfigured',
      }, 500);
    }

    // Generate the real secret and encrypt it.
    const secret      = generateBase32Secret();
    const email       = user.email || 'user';
    const otpauth_url = `otpauth://totp/BorderPay:${encodeURIComponent(email)}?secret=${secret}&issuer=BorderPay`;
    const cipher      = await encryptSecret(secret);
    if (!cipher) {
      return json({ success: false, error: 'Encryption failed', code: 'server_misconfigured' }, 500);
    }

    // Persist via the b64 RPC so the bytea boundary is handled inside
    // PostgreSQL (decode(p_b64, 'base64')). Sending Array.from(cipher)
    // through PostgREST was the v84 bug — that round-tripped as the
    // ASCII text of the JSON array, not as the actual cipher bytes.
    const { error } = await supabase.rpc('set_totp_secret_encrypted_b64', {
      p_user_id:     user.id,
      p_b64:         bytesToB64(cipher),
      p_enc_version: 1,
    });

    if (error) return json({ success: false, error: error.message }, 500);

    return json({ success: true, data: { secret, otpauth_url, encrypted: true } });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
