/**
 * BorderPay Africa - Client-Side Security Manager
 * Handles PIN, TOTP 2FA, and Biometric authentication entirely on-device.
 * No backend edge functions required.
 *
 * - PIN: SHA-256 hashed with random salt, stored in localStorage
 * - TOTP: HMAC-SHA1 based RFC 6238 implementation (Google Authenticator compatible)
 * - Biometric: WebAuthn platform authenticator (Face ID / Touch ID / Fingerprint)
 *
 * Storage key: borderpay_security_{userId}
 */

import { BASE_URL, ANON_KEY } from '../supabase/client';

// ============================================================================
// TYPES
// ============================================================================

export interface SecurityState {
  pinHash: string | null;
  pinSalt: string | null;
  totpSecret: string | null;   // base32 encoded
  totpEnabled: boolean;
  biometricEnabled: boolean;
  biometricCredentialId: string | null;
  biometricPublicKey: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_STATE: SecurityState = {
  pinHash: null,
  pinSalt: null,
  totpSecret: null,
  totpEnabled: false,
  biometricEnabled: false,
  biometricCredentialId: null,
  biometricPublicKey: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ============================================================================
// STORAGE
// ============================================================================

function getStorageKey(userId: string): string {
  return `borderpay_security_${userId}`;
}

function loadState(userId: string): SecurityState {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(userId: string, state: SecurityState): void {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
}

// ============================================================================
// CRYPTO HELPERS
// ============================================================================

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Fire-and-forget sync of security status to backend */
function syncSecurityToBackend(updates: { pin_set?: boolean; two_factor_enabled?: boolean }): void {
  try {
    const token = localStorage.getItem('borderpay_token');
    if (!token) return;
    fetch(`${BASE_URL}/update-security-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify(updates),
    }).catch(() => {});
  } catch { /* non-critical */ }
}

async function sha256(data: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(salt + data + salt);
  // Double hash for extra security
  const firstHash = await crypto.subtle.digest('SHA-256', keyData);
  const secondHash = await crypto.subtle.digest('SHA-256', firstHash);
  return arrayBufferToHex(secondHash);
}

// ============================================================================
// BASE32 ENCODING / DECODING (RFC 4648)
// ============================================================================

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

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

// ============================================================================
// TOTP (RFC 6238) - Google Authenticator Compatible
// ============================================================================

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

function intToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = num & 0xff;
    num = Math.floor(num / 256);
  }
  return bytes;
}

async function generateTOTP(secret: Uint8Array, timeStep: number = 30, digits: number = 6): Promise<string> {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const counterBytes = intToBytes(counter);
  const hmac = await hmacSha1(secret, counterBytes);
  const hmacBytes = new Uint8Array(hmac);

  // Dynamic truncation (RFC 4226)
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const code =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = code % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

async function verifyTOTPCode(secret: Uint8Array, inputCode: string, window: number = 1): Promise<boolean> {
  // Check current time step and adjacent steps (to handle clock skew)
  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000 / timeStep);

  for (let i = -window; i <= window; i++) {
    const counter = now + i;
    const counterBytes = intToBytes(counter);
    const hmac = await hmacSha1(secret, counterBytes);
    const hmacBytes = new Uint8Array(hmac);

    const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
    const code =
      ((hmacBytes[offset] & 0x7f) << 24) |
      ((hmacBytes[offset + 1] & 0xff) << 16) |
      ((hmacBytes[offset + 2] & 0xff) << 8) |
      (hmacBytes[offset + 3] & 0xff);

    const otp = (code % 1000000).toString().padStart(6, '0');
    if (otp === inputCode) return true;
  }

  return false;
}

// ============================================================================
// PIN MANAGEMENT
// ============================================================================

// PIN MANAGEMENT — server is the source of truth.
//
// SECURITY: the PIN hash is NEVER stored in localStorage. setup/verify/change
// all round-trip through the backend (setup-pin / verify-pin / change-pin
// edge functions), so a malicious browser extension cannot extract the hash
// and brute-force a 6-digit PIN offline.
//
// `hasPIN` reads only the boolean `pin_set` flag from the cached profile
// (mirrored from `user_security.pin_set`). The actual hash never touches
// the client.
//
// KNOWN LIMITATIONS (tracked for hardening):
//   • The server-side hash uses single-round SHA-256 with user.id as salt.
//     Should migrate to PBKDF2(100k iters) or Argon2id with a random salt.
//   • verify-pin has no rate-limit / lockout. Should add per-user attempt
//     counter with exponential backoff.
// These are tracked as P1 follow-ups; switching the source-of-truth away
// from localStorage is the high-impact fix shipped today.
export const PINManager = {
  hasPIN(_userId: string): boolean {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) {
        const p = JSON.parse(stored);
        return !!(p?.pin_set);
      }
    } catch { /* ignore */ }
    return false;
  },

  async setupPIN(userId: string, pin: string): Promise<{ success: boolean; error?: string }> {
    if (!/^\d{4,6}$/.test(pin)) {
      return { success: false, error: 'PIN must be 4 to 6 digits' };
    }
    const weakPins = ['000000', '111111', '222222', '333333', '444444', '555555',
      '666666', '777777', '888888', '999999', '123456', '654321', '123123'];
    if (weakPins.includes(pin)) {
      return { success: false, error: 'Please choose a stronger PIN' };
    }
    try {
      const { backendAPI } = await import('../api/backendAPI');
      const r: any = await backendAPI.auth.setupPIN(userId, pin);
      if (!r?.success) return { success: false, error: r?.error || 'Could not set PIN' };
      // Mirror the boolean into the cached profile so hasPIN sees it.
      try {
        const stored = localStorage.getItem('borderpay_user');
        if (stored) {
          const p = JSON.parse(stored); p.pin_set = true;
          localStorage.setItem('borderpay_user', JSON.stringify(p));
        }
      } catch { /* ignore */ }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to set up PIN' };
    }
  },

  async verifyPIN(_userId: string, pin: string): Promise<boolean> {
    try {
      const { backendAPI } = await import('../api/backendAPI');
      const r: any = await backendAPI.auth.verifyPIN(pin);
      return !!r?.success;
    } catch {
      return false;
    }
  },

  async changePIN(_userId: string, currentPin: string, newPin: string): Promise<{ success: boolean; error?: string }> {
    if (!/^\d{4,6}$/.test(newPin)) return { success: false, error: 'PIN must be 4 to 6 digits' };
    try {
      const { backendAPI } = await import('../api/backendAPI');
      const r: any = await backendAPI.auth.changePIN(currentPin, newPin);
      if (!r?.success) return { success: false, error: r?.error || 'Could not change PIN' };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to change PIN' };
    }
  },

  removePIN(_userId: string): void {
    // PIN removal is intentionally NOT exposed to the client. Removing a
    // PIN should require a fresh login + email confirmation; if you need
    // to drop one, contact support. Method is a no-op for caller stability.
  },
};

// ============================================================================
// TOTP 2FA MANAGEMENT
// ============================================================================

// TOTP 2FA MANAGEMENT — server-backed.
//
// SECURITY: TOTP secret is generated server-side by `setup-2fa` and stored
// in `user_security.two_factor_secret`. The secret is returned to the
// client exactly once during enrollment so the user can scan the QR /
// type into their authenticator. After that, verification rounds-trip
// to `verify-2fa` which performs HMAC-SHA1 RFC-6238 verification with
// constant-time compare and ±1 step drift tolerance. The secret never
// touches localStorage post-enrollment.
//
// Known limitation (P2): `two_factor_secret` is stored in plaintext in
// the database. Should be encrypted at rest with a server-only key.
// Tracked separately; the bigger win — moving the secret off the
// client — is done.
export const TOTPManager = {
  isEnabled(_userId: string): boolean {
    // Reads cached profile flag (mirrored from user_security.two_factor_enabled).
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (stored) {
        const p = JSON.parse(stored);
        return !!(p?.two_factor_enabled || p?.mfa_enabled);
      }
    } catch { /* ignore */ }
    return false;
  },

  /**
   * Start 2FA enrollment. Calls `setup-2fa` which generates the TOTP secret
   * server-side, stores it in `user_security.two_factor_secret`, and returns
   * the secret + otpauth_url for QR/manual entry. We never persist the
   * secret client-side — UI components hold it only for the duration of
   * the enrollment screen (until verifyAndEnable runs).
   */
  async generateSecret(_userId: string, _userEmail: string): Promise<{
    secret: string;
    qrCodeUri: string;
    rawSecret: string;
  }> {
    const { backendAPI } = await import('../api/backendAPI');
    const r: any = await backendAPI.auth.setup2FA(_userId);
    if (!r?.success || !r?.data) {
      throw new Error(r?.error || 'Could not start 2FA enrollment');
    }
    const secret    = String(r.data.secret || '');
    const qrCodeUri = String(r.data.otpauth_url || '');
    return { secret, qrCodeUri, rawSecret: secret };
  },

  /**
   * Verify the user-entered code against the server-stored secret and
   * enable 2FA on success. Single endpoint serves both first-enable and
   * subsequent verification (the server idempotently sets
   * two_factor_enabled=true).
   */
  async verifyAndEnable(_userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    if (!/^\d{6}$/.test(code)) {
      return { success: false, error: 'Enter a 6-digit code' };
    }
    try {
      const { backendAPI } = await import('../api/backendAPI');
      const r: any = await backendAPI.auth.verify2FA(_userId, code);
      if (r?.success) {
        // Mirror flags into the cached profile so isEnabled() updates instantly.
        try {
          const stored = localStorage.getItem('borderpay_user');
          if (stored) {
            const u = JSON.parse(stored);
            u.two_factor_enabled = true;
            u.mfa_enabled = true;
            localStorage.setItem('borderpay_user', JSON.stringify(u));
          }
        } catch { /* ignore */ }
        return { success: true };
      }
      return { success: false, error: r?.error || 'Invalid verification code' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Verification failed' };
    }
  },

  /** Same endpoint as verifyAndEnable — used during login / transaction step-up. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const r = await this.verifyAndEnable(userId, code);
    return !!r.success;
  },

  /** Removed in the server-backed migration. */
  async getCurrentCode(_userId: string): Promise<string | null> {
    return null;
  },

  /** Disable 2FA — clears server-side secret + flag. Requires password. */
  async disable(_userId: string, password?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { backendAPI } = await import('../api/backendAPI');
      // disable2FA wraps the disable-2fa edge function with password confirmation.
      const r: any = await backendAPI.auth.disable2FA(_userId, password || '');
      if (r?.success) {
        try {
          const stored = localStorage.getItem('borderpay_user');
          if (stored) {
            const u = JSON.parse(stored);
            u.two_factor_enabled = false;
            u.mfa_enabled = false;
            localStorage.setItem('borderpay_user', JSON.stringify(u));
          }
        } catch { /* ignore */ }
        return { success: true };
      }
      return { success: false, error: r?.error || 'Could not disable 2FA' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not disable 2FA' };
    }
  },
};

// ============================================================================
// BIOMETRIC MANAGEMENT (WebAuthn)
//
// SECURITY MODEL — read before changing any of this:
//
// What this provides today: a *local UX gesture* to unlock the Supabase
// refresh_token cached in localStorage. The platform authenticator (Face ID,
// Touch ID, Android biometric) gates the "biometric sign-in" button. On a
// successful navigator.credentials.get() the app refreshes the Supabase
// session using the stored refresh_token. The refresh_token IS the auth
// credential; the biometric only gates UI access to that flow.
//
// What this DOES NOT provide:
//   • Server-side WebAuthn assertion verification. The challenge is
//     generated client-side and the signature in the assertion is never
//     sent to the server, so the assertion proves nothing to any backend.
//   • Encryption of the refresh_token at rest. Any browser extension /
//     XSS can read `borderpay_refresh_token` directly without a biometric
//     prompt, then call supabase.auth.refreshSession() themselves.
//
// Migration plan to server-verified WebAuthn (P1):
//   1. Add `webauthn_credentials` table: id, user_id, credential_id (b64url),
//      public_key (COSE), counter (bigint), transports, created_at, last_used_at.
//   2. New edge functions:
//        - `biometric-register-options`  → server-issued challenge + RP info
//        - `biometric-register-verify`   → CBOR-decode attestation, store creds
//        - `biometric-auth-options`      → server-issued challenge + allowCreds
//        - `biometric-auth-verify`       → verify signature + counter, mint JWT
//      Use @simplewebauthn/server (Deno-compatible) for crypto.
//   3. Client BiometricManager becomes a thin wrapper; refresh_token is no
//      longer used for biometric login.
//   4. Encrypt cached refresh_token with a WebAuthn-PRF-derived key for the
//      device-bound case where server-verified WebAuthn isn't available.
//
// Until that lands, treat the biometric prompt as "convenience login" and
// keep PIN (server-backed) + email password as the real auth factors.
// ============================================================================

export const BiometricManager = {
  /** Check if device supports biometrics */
  async isSupported(): Promise<boolean> {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  /** Check if biometric is enrolled for this user */
  isEnrolled(userId: string): boolean {
    const state = loadState(userId);
    return state.biometricEnabled && !!state.biometricCredentialId;
  },

  /** Enroll biometric (create WebAuthn credential) */
  async enroll(userId: string, userName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const supported = await this.isSupported();
      if (!supported) {
        return { success: false, error: 'Biometric authentication is not supported on this device' };
      }

      const challenge = generateRandomBytes(32) as BufferSource;
      const userIdBytes = new TextEncoder().encode(userId) as BufferSource;

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'BorderPay Africa',
            id: window.location.hostname,
          },
          user: {
            id: userIdBytes,
            name: userName,
            displayName: userName,
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },   // ES256
            { alg: -257, type: 'public-key' },  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        return { success: false, error: 'Biometric enrollment was cancelled' };
      }

      const credentialId = arrayBufferToBase64(credential.rawId);
      const response = credential.response as AuthenticatorAttestationResponse;
      const publicKey = arrayBufferToBase64(response.getPublicKey?.() || new ArrayBuffer(0));

      const state = loadState(userId);
      state.biometricEnabled = true;
      state.biometricCredentialId = credentialId;
      state.biometricPublicKey = publicKey;
      saveState(userId, state);

      // Also store for login screen quick-access
      localStorage.setItem('borderpay_biometric_credential_id', credentialId);
      localStorage.setItem('borderpay_biometric_user_id', userId);

      return { success: true };
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        return { success: false, error: 'Biometric enrollment was cancelled or timed out' };
      }
      return { success: false, error: err.message || 'Biometric enrollment failed' };
    }
  },

  /** Verify biometric (authenticate with WebAuthn) */
  async verify(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const state = loadState(userId);
      if (!state.biometricEnabled || !state.biometricCredentialId) {
        return { success: false, error: 'Biometric not enrolled' };
      }

      const challenge = generateRandomBytes(32) as BufferSource;
      const credentialIdBuffer = base64ToArrayBuffer(state.biometricCredentialId);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: [{
            id: new Uint8Array(credentialIdBuffer),
            type: 'public-key',
            transports: ['internal'],
          }],
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!assertion) {
        return { success: false, error: 'Biometric verification was cancelled' };
      }

      // If we get here, the platform authenticator verified the user
      return { success: true };
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        return { success: false, error: 'Biometric verification was cancelled or timed out' };
      }
      return { success: false, error: err.message || 'Biometric verification failed' };
    }
  },

  /** Disable biometric */
  disable(userId: string): void {
    const state = loadState(userId);
    state.biometricEnabled = false;
    state.biometricCredentialId = null;
    state.biometricPublicKey = null;
    saveState(userId, state);

    localStorage.removeItem('borderpay_biometric_credential_id');
    localStorage.removeItem('borderpay_biometric_user_id');
  },
};

// ============================================================================
// COMBINED SECURITY STATUS
// ============================================================================

export const SecurityStatus = {
  /** Get full security status for a user */
  get(userId: string): {
    hasPIN: boolean;
    has2FA: boolean;
    hasBiometric: boolean;
    securityLevel: 'none' | 'basic' | 'standard' | 'maximum';
  } {
    const hasPIN = PINManager.hasPIN(userId);
    const has2FA = TOTPManager.isEnabled(userId);
    const hasBiometric = BiometricManager.isEnrolled(userId);

    let securityLevel: 'none' | 'basic' | 'standard' | 'maximum' = 'none';
    const count = [hasPIN, has2FA, hasBiometric].filter(Boolean).length;
    if (count >= 3) securityLevel = 'maximum';
    else if (count >= 2) securityLevel = 'standard';
    else if (count >= 1) securityLevel = 'basic';

    return { hasPIN, has2FA, hasBiometric, securityLevel };
  },

  /** Clear all security data for a user (dangerous!) */
  clearAll(userId: string): void {
    localStorage.removeItem(getStorageKey(userId));
    localStorage.removeItem('borderpay_biometric_credential_id');
    localStorage.removeItem('borderpay_biometric_user_id');
  },
};
