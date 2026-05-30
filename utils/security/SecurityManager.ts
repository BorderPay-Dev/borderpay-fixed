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
// BIOMETRIC MANAGEMENT (server-verified WebAuthn)
//
// Four-call dance with the backend:
//   • enroll  → webauthn-register-options (server issues challenge)
//             → navigator.credentials.create(opts)
//             → webauthn-register-verify (server verifies attestation,
//               persists credential to webauthn_credentials)
//   • verify  → webauthn-auth-options (server issues challenge for the
//               user's enrolled credential IDs)
//             → navigator.credentials.get(opts)
//             → webauthn-auth-verify (server validates signature + counter,
//               bumps the row, marks challenge consumed)
//
// The platform-authenticator gesture (Face ID / Touch ID / Windows Hello)
// is the second factor; the signed assertion is what proves authentication
// to the backend. The previous flow was UX-only (the server got no
// cryptographic evidence) — that's now replaced.
// ============================================================================

// WebAuthn JSON helpers: navigator.credentials.create/get returns
// ArrayBuffers nested in the response. The server functions expect
// base64url-encoded strings (the @simplewebauthn/server convention). These
// helpers do the conversion in both directions.
function _b64uFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = '';
  for (let i = 0; i < arr.byteLength; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _bytesFromB64u(b64u: string): Uint8Array {
  const pad = b64u.length % 4 === 0 ? '' : '='.repeat(4 - (b64u.length % 4));
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Convert server-supplied creation options (b64url challenge + user.id +
// optional excludeCredentials.id) into the BufferSource form the browser
// expects.
function _decodeCreateOptions(options: any): any {
  const o: any = { ...options };
  o.challenge = _bytesFromB64u(options.challenge);
  o.user      = { ...options.user, id: _bytesFromB64u(options.user.id) };
  if (Array.isArray(options.excludeCredentials)) {
    o.excludeCredentials = options.excludeCredentials.map((c: any) => ({
      ...c, id: _bytesFromB64u(c.id),
    }));
  }
  return o;
}
function _decodeRequestOptions(options: any): any {
  const o: any = { ...options };
  o.challenge = _bytesFromB64u(options.challenge);
  if (Array.isArray(options.allowCredentials)) {
    o.allowCredentials = options.allowCredentials.map((c: any) => ({
      ...c, id: _bytesFromB64u(c.id),
    }));
  }
  return o;
}

// Convert a PublicKeyCredential from the browser into the b64url JSON shape
// the server's verifyRegistrationResponse / verifyAuthenticationResponse expect.
function _serializeAttestationResponse(cred: PublicKeyCredential): any {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id:    cred.id,
    rawId: _b64uFromBytes(cred.rawId),
    type:  cred.type,
    authenticatorAttachment: (cred as any).authenticatorAttachment,
    clientExtensionResults:  cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON:    _b64uFromBytes(r.clientDataJSON),
      attestationObject: _b64uFromBytes(r.attestationObject),
      transports:        (r as any).getTransports?.() ?? [],
    },
  };
}
function _serializeAssertionResponse(cred: PublicKeyCredential): any {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id:    cred.id,
    rawId: _b64uFromBytes(cred.rawId),
    type:  cred.type,
    authenticatorAttachment: (cred as any).authenticatorAttachment,
    clientExtensionResults:  cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON:    _b64uFromBytes(r.clientDataJSON),
      authenticatorData: _b64uFromBytes(r.authenticatorData),
      signature:         _b64uFromBytes(r.signature),
      userHandle:        r.userHandle ? _b64uFromBytes(r.userHandle) : null,
    },
  };
}

export const BiometricManager = {
  /** Platform-authenticator capability check. */
  async isSupported(): Promise<boolean> {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  /**
   * Enrolled boolean (cached). The truth lives in webauthn_credentials —
   * this is a lightweight hint for the UI. The cache is set after a
   * successful server-verified enroll and cleared on disable.
   */
  isEnrolled(_userId: string): boolean {
    try {
      return localStorage.getItem('borderpay_biometric_enrolled') === 'true';
    } catch {
      return false;
    }
  },

  /**
   * Enroll a new platform authenticator. Calls webauthn-register-options,
   * runs navigator.credentials.create, ships the attestation to
   * webauthn-register-verify which persists to webauthn_credentials.
   */
  async enroll(userId: string, _userName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const supported = await this.isSupported();
      if (!supported) {
        return { success: false, error: 'Biometric authentication is not supported on this device' };
      }

      const { backendAPI } = await import('../api/backendAPI');
      const optsRes: any = await backendAPI.webauthn.registerOptions();
      if (!optsRes?.success || !optsRes.data?.options) {
        return { success: false, error: optsRes?.error || 'Could not start enrollment' };
      }

      const publicKey = _decodeCreateOptions(optsRes.data.options);
      let credential: PublicKeyCredential | null;
      try {
        credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') return { success: false, error: 'Enrollment cancelled or timed out' };
        // InvalidStateError = a credential for this RP+user already exists on
        // this authenticator (e.g. a prior enroll that wasn't fully removed).
        if (err?.name === 'InvalidStateError') {
          return { success: false, error: 'Biometric is already set up on this device. Disable it first, then try again.' };
        }
        return { success: false, error: err?.message || 'Enrollment failed' };
      }
      if (!credential) return { success: false, error: 'No credential returned by the authenticator' };

      const verifyRes: any = await backendAPI.webauthn.registerVerify({
        response: _serializeAttestationResponse(credential),
      });
      if (!verifyRes?.success) {
        return { success: false, error: verifyRes?.error || 'Server could not verify the new credential' };
      }

      try {
        localStorage.setItem('borderpay_biometric_enrolled', 'true');
        localStorage.setItem('borderpay_biometric_user_id', userId);
      } catch { /* non-critical */ }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Enrollment failed' };
    }
  },

  /**
   * Authenticate via WebAuthn. Calls webauthn-auth-options, runs
   * navigator.credentials.get, ships the assertion to webauthn-auth-verify
   * which checks the signature + counter and bumps the row.
   */
  async verify(_userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { backendAPI } = await import('../api/backendAPI');
      const optsRes: any = await backendAPI.webauthn.authOptions();
      if (!optsRes?.success || !optsRes.data?.options) {
        return { success: false, error: optsRes?.error || 'Could not start authentication' };
      }

      const publicKey = _decodeRequestOptions(optsRes.data.options);
      let assertion: PublicKeyCredential | null;
      try {
        assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') return { success: false, error: 'Authentication cancelled or timed out' };
        return { success: false, error: err?.message || 'Authentication failed' };
      }
      if (!assertion) return { success: false, error: 'No assertion returned by the authenticator' };

      const verifyRes: any = await backendAPI.webauthn.authVerify({
        response: _serializeAssertionResponse(assertion),
      });
      if (!verifyRes?.success) {
        return { success: false, error: verifyRes?.error || 'Server could not verify the assertion' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Authentication failed' };
    }
  },

  /**
   * Disable biometric: delete the SERVER credential(s) first, then clear the
   * local hint — but ONLY if the server delete succeeded. A local-only clear
   * leaves an orphan webauthn_credentials row, and the next enroll on this
   * device fails with InvalidStateError (register-options excludeCredentials).
   * Returns success/error so the UI can avoid pretending it disabled.
   */
  async disable(_userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { backendAPI } = await import('../api/backendAPI');
      const r: any = await backendAPI.webauthn.disable();
      if (!r?.success) {
        return { success: false, error: r?.error || 'Could not disable biometric on the server' };
      }
      try {
        localStorage.removeItem('borderpay_biometric_enrolled');
        localStorage.removeItem('borderpay_biometric_user_id');
        localStorage.removeItem('borderpay_biometric_credential_id');
      } catch { /* non-critical */ }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Could not disable biometric' };
    }
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
