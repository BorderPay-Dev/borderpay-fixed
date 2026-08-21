// verify-2fa v87 — decrypts AES-256-GCM TOTP secret via base64 RPC,
// verifies RFC-6238 (round-7 P1 fix).
//
// SOURCE OF TRUTH for deployed version 86/87. Reads the encrypted secret
// from user_security via the `get_totp_secret_encrypted_b64` RPC
// (added in migration 20260520000000_totp_secret_b64_rpcs.sql), which
// returns the bytea column as a base64 string so we never have to
// parse PostgREST's `\x...` bytea text representation. Decrypts under
// TOTP_ENCRYPTION_KEY (server-only env), then runs RFC-6238
// verification: HMAC-SHA1, 30s step, ±1 step drift tolerance,
// constant-time compare.
//
// FAILS CLOSED if TOTP_ENCRYPTION_KEY is missing or malformed — returns
// 500 server_misconfigured. The previous plaintext read-fallback was
// removed per CTO review: the "encrypted at rest" claim was being
// undermined by a quiet plaintext path.
//
// On first successful verify, sets two_factor_enabled = true.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── RFC-6238 helpers ────────────────────────────────────────────────────
function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/[=\s]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const ch of cleaned) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(bytes);
}
function intToBytes(n: number): Uint8Array {
  const b = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { b[i] = n & 0xff; n = Math.floor(n / 256); }
  return b;
}
async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<ArrayBuffer> {
  const ck = await crypto.subtle.importKey(
    'raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', ck, message as BufferSource);
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function verifyTOTP(secret: string, token: string, win = 1): Promise<number | null> {
  const secretBytes = base32Decode(secret);
  const step = 30;
  const now  = Math.floor(Date.now() / 1000 / step);
  for (let i = -win; i <= win; i++) {
    const counter = now + i;
    const hmac    = new Uint8Array(await hmacSha1(secretBytes, intToBytes(counter)));
    const offset  = hmac[hmac.length - 1] & 0x0f;
    const code    = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
                    ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    const otp     = (code % 1000000).toString().padStart(6, '0');
    if (constantTimeEqual(otp, token)) return counter;
  }
  return null;
}

// ── AES-GCM helpers ─────────────────────────────────────────────────────
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function importDecKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get('TOTP_ENCRYPTION_KEY');
  if (!raw) return null;
  let bytes: Uint8Array;
  try { bytes = b64ToBytes(raw); } catch { return null; }
  if (bytes.byteLength !== 32) return null;
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
}
async function decryptSecret(blob: Uint8Array, key: CryptoKey): Promise<string | null> {
  if (blob.byteLength < 12 + 16) return null;
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
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

    const { token: totpToken } = await req.json();
    if (!totpToken || !/^\d{6}$/.test(totpToken)) {
      return json({ success: false, error: 'Token must be 6 digits' }, 400);
    }

    // Fail closed if encryption key is missing — we will not silently
    // fall back to reading the legacy plaintext column.
    const decKey = await importDecKey();
    if (!decKey) {
      console.error('verify-2fa: TOTP_ENCRYPTION_KEY missing or invalid — failing closed');
      return json({
        success: false,
        error:   'Two-factor verification is temporarily unavailable. Please try again shortly.',
        code:    'server_misconfigured',
      }, 500);
    }

    // Read via the b64 RPC. PostgREST returns bytea columns as a
    // `\x...` hex string in JSON which the previous version mis-parsed
    // with `new Uint8Array(string)` (always produced zero-length
    // garbage). The RPC returns a base64 string instead — clean text
    // round-trip, decoded here with the standard base64 → Uint8Array
    // path. See migration 20260520000000_totp_secret_b64_rpcs.sql.
    const { data: b64, error: fetchErr } = await supabase.rpc(
      'get_totp_secret_encrypted_b64',
      { p_user_id: user.id },
    );
    if (fetchErr) return json({ success: false, error: fetchErr.message }, 500);
    if (!b64 || typeof b64 !== 'string' || b64.length === 0) {
      return json({ success: false, error: '2FA not set up' }, 400);
    }

    const blob = b64ToBytes(b64);
    const secret = await decryptSecret(blob, decKey);
    if (!secret) {
      console.error(`verify-2fa: decryption failed for user_id=${user.id}`);
      return json({ success: false, error: 'Secret unavailable', code: 'decrypt_failed' }, 500);
    }

    const verifiedCounter = await verifyTOTP(secret, totpToken);
    if (verifiedCounter === null) {
      return json({ success: false, error: 'Invalid verification code' }, 401);
    }

    // A TOTP is a one-time factor, not a 30-second reusable password. Consume
    // the matched counter atomically so concurrent or repeated submissions of
    // the same code fail closed across login and SCA flows.
    const { data: counterConsumed, error: counterError } = await supabase.rpc(
      'consume_totp_counter',
      { p_user_id: user.id, p_counter: verifiedCounter },
    );
    if (counterError) return json({ success: false, code: 'totp_replay_guard_unavailable', error: 'Verification is temporarily unavailable.' }, 503);
    if (counterConsumed !== true) return json({ success: false, code: 'totp_replayed', error: 'This authenticator code was already used. Wait for the next code.' }, 401);

    const { error: updateError } = await supabase
      .from('user_security')
      .upsert(
        { user_id: user.id, two_factor_enabled: true },
        { onConflict: 'user_id' },
      );
    if (updateError) return json({ success: false, error: updateError.message }, 500);

    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
