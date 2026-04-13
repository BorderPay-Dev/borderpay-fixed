import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TOTP verification helpers (RFC 6238 / RFC 4226)
// ============================================================================

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/[=\s]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

function intToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = num & 0xff;
    num = Math.floor(num / 256);
  }
  return bytes;
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, message as BufferSource);
}

/**
 * Verify a TOTP token against a base32-encoded secret.
 * Checks the current time step and ±1 step for clock drift tolerance.
 * Returns true only if the token matches one of the valid time windows.
 */
async function verifyTOTP(secret: string, token: string, window = 1): Promise<boolean> {
  const secretBytes = base32Decode(secret);
  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000 / timeStep);

  for (let i = -window; i <= window; i++) {
    const counter = now + i;
    const counterBytes = intToBytes(counter);
    const hmac = await hmacSha1(secretBytes, counterBytes);
    const hmacBytes = new Uint8Array(hmac);

    // Dynamic truncation (RFC 4226 Section 5.4)
    const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
    const code =
      ((hmacBytes[offset] & 0x7f) << 24) |
      ((hmacBytes[offset + 1] & 0xff) << 16) |
      ((hmacBytes[offset + 2] & 0xff) << 8) |
      (hmacBytes[offset + 3] & 0xff);

    const otp = (code % 1000000).toString().padStart(6, '0');

    // Constant-time comparison to prevent timing attacks
    if (constantTimeEqual(otp, token)) {
      return true;
    }
  }

  return false;
}

/** Constant-time string comparison to prevent timing side-channel attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// Edge function handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { token: totpToken } = await req.json();

    if (!totpToken || !/^\d{6}$/.test(totpToken)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token must be 6 digits' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the user's stored TOTP secret
    const { data: security, error: fetchError } = await supabase
      .from('user_security')
      .select('two_factor_secret')
      .eq('user_id', user.id)
      .single();

    if (fetchError || !security || !security.two_factor_secret) {
      return new Response(
        JSON.stringify({ success: false, error: '2FA not set up' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the submitted token against the stored TOTP secret
    // Uses RFC 6238 TOTP with HMAC-SHA1, 30s period, ±1 step drift tolerance
    const isValid = await verifyTOTP(security.two_factor_secret, totpToken);

    if (!isValid) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid verification code' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Token is valid — mark 2FA as enabled
    const { error: updateError } = await supabase
      .from('user_security')
      .update({ two_factor_enabled: true })
      .eq('user_id', user.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
