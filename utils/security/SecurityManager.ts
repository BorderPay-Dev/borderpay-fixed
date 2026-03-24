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

export const PINManager = {
  /** Check if user has a PIN set up */
  hasPIN(userId: string): boolean {
    const state = loadState(userId);
    return !!state.pinHash && !!state.pinSalt;
  },

  /** Set up a new PIN (first time or reset) */
  async setupPIN(userId: string, pin: string): Promise<{ success: boolean; error?: string }> {
    if (!/^\d{6}$/.test(pin)) {
      return { success: false, error: 'PIN must be exactly 6 digits' };
    }

    const weakPins = ['000000', '111111', '222222', '333333', '444444', '555555',
      '666666', '777777', '888888', '999999', '123456', '654321', '123123'];
    if (weakPins.includes(pin)) {
      return { success: false, error: 'Please choose a stronger PIN' };
    }

    try {
      const salt = arrayBufferToHex(generateRandomBytes(32).buffer as ArrayBuffer);
      const hash = await sha256(pin, salt);

      const state = loadState(userId);
      state.pinHash = hash;
      state.pinSalt = salt;
      if (!state.createdAt || state.createdAt === DEFAULT_STATE.createdAt) {
        state.createdAt = new Date().toISOString();
      }
      saveState(userId, state);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to set up PIN' };
    }
  },

  /** Verify a PIN against the stored hash */
  async verifyPIN(userId: string, pin: string): Promise<boolean> {
    const state = loadState(userId);
    if (!state.pinHash || !state.pinSalt) return false;

    try {
      const hash = await sha256(pin, state.pinSalt);
      return hash === state.pinHash;
    } catch {
      return false;
    }
  },

  /** Change PIN (requires current PIN verification) */
  async changePIN(userId: string, currentPin: string, newPin: string): Promise<{ success: boolean; error?: string }> {
    const isValid = await this.verifyPIN(userId, currentPin);
    if (!isValid) {
      return { success: false, error: 'Current PIN is incorrect' };
    }
    return this.setupPIN(userId, newPin);
  },

  /** Remove PIN */
  removePIN(userId: string): void {
    const state = loadState(userId);
    state.pinHash = null;
    state.pinSalt = null;
    saveState(userId, state);
  },
};

// ============================================================================
// TOTP 2FA MANAGEMENT
// ============================================================================

export const TOTPManager = {
  /** Check if 2FA is enabled */
  isEnabled(userId: string): boolean {
    const state = loadState(userId);
    return state.totpEnabled && !!state.totpSecret;
  },

  /** Generate a new TOTP secret and return setup data */
  generateSecret(userId: string, userEmail: string): {
    secret: string;         // base32 secret for manual entry
    qrCodeUri: string;      // otpauth:// URI for QR code
    rawSecret: string;      // stored internally
  } {
    const secretBytes = generateRandomBytes(20); // 160-bit secret
    const secret = base32Encode(secretBytes);
    const issuer = 'BorderPay%20Africa';
    const account = encodeURIComponent(userEmail);
    const qrCodeUri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    // Store the secret temporarily (not yet enabled until verified)
    const state = loadState(userId);
    state.totpSecret = secret;
    state.totpEnabled = false; // Will be enabled after verification
    saveState(userId, state);

    return { secret, qrCodeUri, rawSecret: secret };
  },

  /** Verify a TOTP code and enable 2FA if valid */
  async verifyAndEnable(userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    const state = loadState(userId);
    if (!state.totpSecret) {
      return { success: false, error: 'No TOTP secret found. Please set up 2FA first.' };
    }

    try {
      const secretBytes = base32Decode(state.totpSecret);
      const isValid = await verifyTOTPCode(secretBytes, code);

      if (isValid) {
        state.totpEnabled = true;
        saveState(userId, state);

        // Also update the stored user profile to reflect 2FA status
        try {
          const storedUser = localStorage.getItem('borderpay_user');
          if (storedUser) {
            const user = JSON.parse(storedUser);
            user.two_factor_enabled = true;
            user.mfa_enabled = true;
            localStorage.setItem('borderpay_user', JSON.stringify(user));
          }
        } catch { /* non-critical */ }

        return { success: true };
      } else {
        return { success: false, error: 'Invalid verification code. Please try again.' };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Verification failed' };
    }
  },

  /** Verify a TOTP code (for login / transaction verification) */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const state = loadState(userId);
    if (!state.totpSecret || !state.totpEnabled) return false;

    try {
      const secretBytes = base32Decode(state.totpSecret);
      return verifyTOTPCode(secretBytes, code);
    } catch {
      return false;
    }
  },

  /** Get the current TOTP code (for testing/debug only) */
  async getCurrentCode(userId: string): Promise<string | null> {
    const state = loadState(userId);
    if (!state.totpSecret) return null;

    try {
      const secretBytes = base32Decode(state.totpSecret);
      return generateTOTP(secretBytes);
    } catch {
      return null;
    }
  },

  /** Disable 2FA */
  disable(userId: string): void {
    const state = loadState(userId);
    state.totpSecret = null;
    state.totpEnabled = false;
    saveState(userId, state);

    // Update stored user profile
    try {
      const storedUser = localStorage.getItem('borderpay_user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        user.two_factor_enabled = false;
        user.mfa_enabled = false;
        localStorage.setItem('borderpay_user', JSON.stringify(user));
      }
    } catch { /* non-critical */ }
  },
};

// ============================================================================
// BIOMETRIC MANAGEMENT (WebAuthn)
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
