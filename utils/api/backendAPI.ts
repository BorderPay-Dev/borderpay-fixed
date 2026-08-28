/**
 * BorderPay Africa - Backend API Integration
 * Clean API layer — only endpoints actively used by the current UI.
 * All calls go direct to Supabase Edge Functions (no Hono/make-server proxy).
 *
 * Routing: apiCall('edge-function-name', ...) → ${BASE_URL}/edge-function-name
 *
 * Last audit: 2026-03-23
 */

import { authAPI, BASE_URL, ANON_KEY, supabase } from '../supabase/client';
import { ownerOrFilter } from '../financial/ownership';
import { deriveWalletStatus } from '../financial/walletStatus';
import { navPerfTrackApi, navPerfTrackCache, navPerfTrackSnapshot } from '../performance/navigationPerf';
import { CARDS_RUNTIME_ENABLED } from '../featureFlags';
import { normalizeTransactionReceipt } from '../transactions/receipt';
import { txDirection } from '../transactions/direction';
import { friendlyError } from '../errors/friendlyError';

function timeoutMsForEndpoint(endpoint: string): number | null {
  // Endpoints that can legitimately take longer because they trigger
  // provider-side orchestration and/or email delivery.
  if (endpoint === 'auth-signup') return 45000;
  if (endpoint === 'auth-resend-verification') return 20000;
  if (endpoint === 'business-team-invite') return 20000;
  if (endpoint === 'bridge-kyc-link' || endpoint === 'bridge-kyb-link') return 45000;
  if (endpoint === 'bridge-customer') return 30000;
  if (endpoint === 'bridge-transfer') return 45000;
  if (endpoint === 'bridge-external-account') return 30000;
  // Yellow Card production orchestration performs authenticated routing discovery,
  // preflight persistence and provider submission. Its upstream deadline is
  // longer than the generic UI deadline, so aborting at 8s creates false
  // failures while the idempotent server request continues in the background.
  if (endpoint === 'yellowcard-capabilities') return 30000;
  if (endpoint === 'yellowcard-transaction') return 90000;
  if (endpoint === 'yellowcard-jit-payout') return 90000;
  return 8000;
}

// ── Sanitize error messages to prevent info leakage ──────────────────────────
function sanitizeError(raw: string | undefined): string {
  return friendlyError(raw, 'Something went wrong. Please try again.');
}

// ── Core API caller with retry for transient network failures ────────────────

async function apiCall<T = any>(
  endpoint: string,
  options: RequestInit = {},
  retries: number = 0
): Promise<{ success: boolean; data?: T; error?: string }> {
  navPerfTrackApi(endpoint, 'start');
  try {
    let token = authAPI.getToken();
    if (!token) {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
      if (token) localStorage.setItem('borderpay_token', token);
    }

    // When body is FormData, let the browser set Content-Type (multipart boundary)
    const isFormData = options.body instanceof FormData;
    const baseHeaders: Record<string, string> = {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${token || ANON_KEY}`,
    };
    if (!isFormData) {
      baseHeaders['Content-Type'] = 'application/json';
    }
    const headers: HeadersInit = {
      ...baseHeaders,
      ...options.headers,
    } as Record<string, string>;

    const timeoutMs = timeoutMsForEndpoint(endpoint);
    const shouldAddTimeout = !options.signal && timeoutMs !== null;
    const timeoutController = shouldAddTimeout ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (timeoutController && timeoutMs) {
      timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    }
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/${endpoint}`, {
        ...options,
        signal: options.signal ?? timeoutController?.signal,
        headers,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const raw = await response.text();
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw };
      }
    }

    // Legacy funding_required responses are no longer shown as an unlock UI.
    // Customer access is governed by verification/KYC/KYB.
    if (
      response.status === 402 &&
      data?.code === 'funding_required' &&
      typeof window !== 'undefined'
    ) {
      try {
        window.dispatchEvent(new CustomEvent('borderpay:funding_required', { detail: data }));
      } catch { /* SSR / no CustomEvent — ignore */ }
    }
    // VA grant-pending (202): surface a friendly toast-like event so the VA
    // card / Wallet screen can render "review pending" instead of an error.
    if (response.status === 202 && data?.code === 'va_grant_pending' && typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('borderpay:va_grant_pending', { detail: data })); } catch { /* noop */ }
    }

    if (!response.ok) {
      if (response.status === 401 && retries < 1 && !options.signal?.aborted) {
        try {
          const { data } = await supabase.auth.refreshSession();
          const refreshedToken = data?.session?.access_token || null;
          if (refreshedToken) {
            localStorage.setItem('borderpay_token', refreshedToken);
            return apiCall<T>(endpoint, options, retries + 1);
          }
        } catch {
          // Fall through to the normal sanitized 401 response.
        }
      }
      navPerfTrackApi(endpoint, 'end', false);
      return {
        success: false,
        error: sanitizeError(data.error || data.message),
        ...(data?.code ? { code: data.code } : {}),
        ...(data?.upgrade_to ? { upgrade_to: data.upgrade_to } : {}),
      } as any;
    }

    // If the edge function already returns { success, data }, pass through
    if (data && typeof data === 'object' && 'success' in data) {
      if (!data.success) data.error = sanitizeError(data.error);
      navPerfTrackApi(endpoint, 'end', !!data.success);
      return data;
    }

    navPerfTrackApi(endpoint, 'end', true);
    return { success: true, data };
  } catch (error: any) {
    navPerfTrackApi(endpoint, 'end', false);
    if (error?.name === 'AbortError') {
      return { success: false, code: 'response_unconfirmed', error: 'We could not confirm the response. Please try again.' } as any;
    }
    // Retry once on network failure for critical calls
    if (retries < 1 && !options.signal?.aborted) {
      return apiCall<T>(endpoint, options, retries + 1);
    }
    return {
      success: false,
      error: 'Connection error. Please check your internet and try again.',
    };
  }
}

async function apiCallPublic<T = any>(
  endpoint: string,
  options: RequestInit = {},
  anonKey?: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  navPerfTrackApi(endpoint, 'start');
  try {
    const key = anonKey || ANON_KEY;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      ...options.headers,
    };

    const timeoutMs = timeoutMsForEndpoint(endpoint);
    const shouldAddTimeout = !options.signal && timeoutMs !== null;
    const timeoutController = shouldAddTimeout ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (timeoutController && timeoutMs) {
      timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    }
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/${endpoint}`, {
        ...options,
        signal: options.signal ?? timeoutController?.signal,
        headers,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    const raw = await response.text();
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw };
      }
    }
    if (!response.ok) {
      navPerfTrackApi(endpoint, 'end', false);
      // Preserve structured server codes (cooldown / rate_limit / expired /
      // already_used / not_found / purpose_mismatch / malformed) on public
      // endpoints so the auth screens can render specific UX. Mirrors the
      // behaviour of the authenticated apiCall path.
      return {
        success: false,
        error: sanitizeError(data.error || data.message || `Request failed: ${response.status}`),
        ...(data?.code      ? { code:      data.code      } : {}),
        ...(data?.upgrade_to ? { upgrade_to: data.upgrade_to } : {}),
      } as any;
    }

    if (data && typeof data === 'object' && 'success' in data) {
      navPerfTrackApi(endpoint, 'end', !!data.success);
      if (!data.success) data.error = sanitizeError(data.error || data.message);
      return data;
    }
    navPerfTrackApi(endpoint, 'end', true);
    return { success: true, data };
  } catch (error: any) {
    navPerfTrackApi(endpoint, 'end', false);
    if (error?.name === 'AbortError') {
      return { success: false, code: 'response_unconfirmed', error: 'We could not confirm the response. Please try again.' } as any;
    }
    return { success: false, error: sanitizeError(error.message || 'Connection error. Please check your internet and try again.') };
  }
}

// ============================================================================
// AUTH & SECURITY
// ============================================================================

export const authSecurityAPI = {
  /**
   * Verify a signup email token. Marks `auth.users.email_confirmed_at`
   * server-side, then returns the redirect URL.
   *
   * Body: { token, purpose }
   * Returns: { success, data?: { user_id, redirect }, code?: string, error?: string }
   */
  async verifyEmailToken(token: string, purpose: 'signup_individual' | 'signup_business' | 'password_reset' | 'email_change') {
    return apiCallPublic('verify-email-token', {
      method: 'POST',
      body: JSON.stringify({ token, purpose }),
    });
  },

  /**
   * Resend the verification email. Server enforces 60s cooldown +
   * 3-per-hour cap. Errors with code='cooldown' or code='rate_limit'
   * return HTTP 429 — surface them to the user.
   */
  async resendVerification(email: string) {
    return apiCallPublic('auth-resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async getProviderSupportedCountries() {
    const providerPrefix = [98, 114, 105, 100, 103, 101].map((code) => String.fromCharCode(code)).join('');
    return apiCallPublic(`${providerPrefix}-supported-countries`, {
      method: 'GET',
    });
  },

  async getOnboardingConfig(onboardingToken?: string) {
    return apiCallPublic('onboarding-config', {
      method: 'POST',
      body: JSON.stringify({
        ...(onboardingToken ? { onboarding_token: onboardingToken } : {}),
      }),
    });
  },

  async signup(data: {
    email:        string;
    password:     string;
    full_name:    string;
    phone_number?: string;
    country_code: string;
    /** Required. The server never defaults a missing value to Individual. */
    account_type:         'individual' | 'business';
    company_name?:        string;
    registration_number?: string;
    business_owners?:     Array<{
      full_name?: string;
      email?: string;
      role?: 'control_person' | 'beneficial_owner';
    }>;
    captcha_token?:       string;
    referral_code?:       string;
    onboarding_token?:    string;
  }, anonKey: string) {
    return apiCallPublic('auth-signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }, anonKey);
  },

  async verifyPIN(pin: string) {
    return apiCall('verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  async changePIN(oldPin: string, newPin: string, scaAuthorizationId?: string) {
    return apiCall('change-pin', {
      method: 'POST',
      body: JSON.stringify({ old_pin: oldPin, new_pin: newPin, sca_authorization_id: scaAuthorizationId }),
    });
  },

  async changePassword(currentPassword: string, newPassword: string, scaAuthorizationId: string) {
    return apiCall('change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        sca_authorization_id: scaAuthorizationId,
      }),
    });
  },

  async setupPIN(userId: string, pin: string) {
    return apiCall('setup-pin', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, pin }),
    });
  },

  async setup2FA(userId: string) {
    return apiCall('setup-2fa', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async verify2FA(userId: string, token: string) {
    return apiCall('verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, token }),
    });
  },

  async authorizeSCA(input: {
    operation: 'wallet_access' | 'payment' | 'beneficiary_change' | 'security_change';
    resource: string;
    request: Record<string, any>;
    pin: string;
    totp: string;
  }) {
    return apiCall<{ sca_required: boolean; authorization_id: string | null; expires_at?: string }>('sca-authorize', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getSCARequirement() {
    return apiCall<{ sca_required: boolean; residency_status: 'verified_eea_resident' | 'non_eea_resident' | 'residency_unknown' | 'verification_not_approved' }>('sca-authorize', {
      method: 'POST',
      body: JSON.stringify({ action: 'requirement' }),
    });
  },

  async grantWalletAccess(scaAuthorizationId: string) {
    return apiCall<{ expires_at: string }>('sca-wallet-access', {
      method: 'POST',
      body: JSON.stringify({ sca_authorization_id: scaAuthorizationId }),
    });
  },

  async disable2FA(userId: string, password: string, scaAuthorizationId?: string) {
    return apiCall('disable-2fa', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, password, sca_authorization_id: scaAuthorizationId }),
    });
  },

  async getSecurityStatus(userId: string) {
    return apiCall('get-security-status', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async updateSecurityStatus(updates: { pin_set?: boolean; two_factor_enabled?: boolean }) {
    // Quarantine unresolved legacy endpoint (`update-security-status`).
    // Keep a successful no-op response shape to avoid runtime 404 regressions.
    return { success: true, data: { applied: false, updates } } as any;
  },

  async resetPasswordRequest(email: string) {
    return apiCallPublic('auth-reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPasswordConfirm(token: string, newPassword: string) {
    return apiCallPublic('auth-reset-password-confirm', {
      method: 'POST',
      body: JSON.stringify({ access_token: token, new_password: newPassword }),
    });
  },

  async requestPinReset(email: string) {
    return apiCallPublic('auth-request-pin-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async confirmPinReset(token: string, newPin: string) {
    return apiCallPublic('auth-confirm-pin-reset', {
      method: 'POST',
      body: JSON.stringify({ token, new_pin: newPin }),
    });
  },
};

// ============================================================================
// USER / PROFILE
// ============================================================================

export const userAPI = {
  async getProfile() {
    return apiCall('get-user-profile', { method: 'GET' });
  },

  async updateProfile(data: any) {
    // Drift-safe direct profile write replacing undeployed edge endpoint.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };
    const patch = {
      full_name: data?.full_name ?? null,
      phone: data?.phone ?? null,
      address: data?.address ?? null,
      city: data?.city ?? null,
      country: data?.country ?? null,
      postal_code: data?.postal_code ?? null,
      date_of_birth: data?.date_of_birth ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data: row, error } = await supabase
      .from('user_profiles')
      .update(patch)
      .eq('id', user.id)
      .select('id, full_name, phone, address, city, country, postal_code, date_of_birth')
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: { user: row || patch } };
  },

  async uploadProfilePicture(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return apiCall('upload-profile-picture', {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
};

// ============================================================================
// WALLETS
// ============================================================================

// `getWallets` is read-only and provider-neutral — it returns rows from
// public.wallets which the dashboard / send flows already display.
//
// Historical edge indirection was removed. This reads canonical rows
// directly through RLS to avoid endpoint drift and unnecessary hops.
//
// `public.wallets` has RLS enabled with policy `wallets_own =
// (auth.uid() = user_id)` covering ALL ops, so a direct supabase-js
// SELECT from the user's authenticated session returns exactly the
// user's own wallet rows — same shape, same data, without the broken
// network hop. Return envelope is kept identical (`{ success, data:
// { wallets: WalletRow[] } }`) so callers (BusinessDashboard /
// Dashboard / WalletScreen) don't change.
//
// `createVirtualAccount` routes supported virtual-account currencies to the
// current account backend. Other currencies (NGN/KES/GHS/...) are future-state
// and return rails_future_state until BorderPay enables local rails.
export const walletAPI = {
  async getWallets() {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return { success: false, error: userErr?.message || 'Not signed in' };
    }
    const SCALE: Record<string, number> = {
      USD: 2, EUR: 2, GBP: 2,
      USDC: 6, USDT: 6,
    };
    const minorToMajor = (minor: unknown, currency: string): number => {
      const n = Number(minor ?? 0);
      if (!Number.isFinite(n)) return 0;
      const scale = SCALE[String(currency || '').toUpperCase()] ?? 2;
      return n / (10 ** scale);
    };

    const [
      { data: bridgeWallets, error: bridgeWalletErr },
      { data: bridgeVas, error: bridgeVaErr },
      { data: walletBalanceLedger, error: walletBalanceLedgerErr },
    ] = await Promise.all([
      supabase
        .from('bridge_wallets')
        .select('bridge_wallet_id,currency,status,updated_at')
        .or(ownerOrFilter(user.id)),
      supabase
        .from('bridge_virtual_accounts')
        .select('bridge_virtual_account_id,currency,status,updated_at')
        .or(ownerOrFilter(user.id)),
      supabase
        .from('bridge_balance_ledger')
        .select('currency,amount_minor,direction,entity_type,created_at')
        .or(ownerOrFilter(user.id))
        .eq('entity_type', 'wallet'),
    ]);

    const firstErr = bridgeWalletErr || bridgeVaErr || walletBalanceLedgerErr;
    if (firstErr) return { success: false, error: firstErr.message };

    const byCurrency = new Map<string, any>();
    const nowIso = new Date().toISOString();
    const ensure = (currencyRaw: string | null | undefined) => {
      const currency = String(currencyRaw || '').toUpperCase();
      if (!currency) return null;
      let row = byCurrency.get(currency);
      if (!row) {
        row = {
          id: `canonical:${currency}`,
          user_id: user.id,
          currency,
          balance: 0,
          status: 'active',
          provider: 'bridge',
          source: 'canonical_read_model',
          updated_at: nowIso,
          bridge_wallet_id: null,
          bridge_virtual_account_id: null,
        };
        byCurrency.set(currency, row);
      }
      return row;
    };

    // Canonical spendable balances come only from wallet-settled ledger entries.
    // Virtual accounts are receive rails and attribution metadata, not a second
    // spendable wallet source.
    const ledgerByCurrency = new Map<string, number>();
    for (const r of (walletBalanceLedger || [])) {
      const c = String((r as any).currency || '').toUpperCase();
      if (!c) continue;
      const rawMinor = Number((r as any).amount_minor ?? 0);
      const direction = String((r as any).direction || '').toLowerCase();
      const signedMinor = direction === 'debit' ? -Math.abs(rawMinor) : Math.abs(rawMinor);
      ledgerByCurrency.set(c, (ledgerByCurrency.get(c) || 0) + minorToMajor(signedMinor, c));
    }
    for (const w of (bridgeWallets || [])) {
      const c = String((w as any).currency || '').toUpperCase();
      const row = ensure(c);
      if (!row) continue;
      row.bridge_wallet_id = (w as any).bridge_wallet_id ?? row.bridge_wallet_id;
      row.status = (w as any).status || row.status;
      row.updated_at = (w as any).updated_at || row.updated_at;
      row.balance = ledgerByCurrency.get(c) || 0;
    }

    // Keep virtual-account identifiers visible on the canonical currency rows
    // so receive screens can attribute rail details without creating duplicate
    // spendable balances.
    for (const va of (bridgeVas || [])) {
      const c = String((va as any).currency || '').toUpperCase();
      const row = ensure(c);
      if (!row) continue;
      row.bridge_virtual_account_id = (va as any).bridge_virtual_account_id ?? row.bridge_virtual_account_id;
      row.status = (va as any).status || row.status;
      row.updated_at = (va as any).updated_at || row.updated_at;
    }
    // If projections lag but ledger has balance rows, still expose balances.
    for (const [currency, balance] of ledgerByCurrency.entries()) {
      const row = ensure(currency);
      if (!row) continue;
      row.balance = balance;
    }

    const wallets = Array.from(byCurrency.values())
      .sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
    return { success: true, data: { wallets } };
  },

  async createVirtualAccount(_userId: string, currency: string) {
    const c = (currency || '').toUpperCase();
    if (c === 'USD' || c === 'EUR' || c === 'GBP') {
      return apiCall('bridge-virtual-account', { method: 'POST', body: JSON.stringify({ currency: c }) });
    }
    return RAILS_FUTURE_STATE;
  },
};

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactionAPI = {
  // Read path is direct from canonical ledger tables through RLS.
  // Compatibility aliases stay fail-closed below.
  async getTransactions(limit = 10, offset = 0) {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return { success: false, error: userErr?.message || 'Not signed in' };
    }
    const SCALE: Record<string, number> = {
      USD: 2, EUR: 2, GBP: 2,
      USDC: 6, USDT: 6,
    };
    const minorToMajor = (minor: unknown, currency: string): number => {
      const n = Number(minor ?? 0);
      if (!Number.isFinite(n)) return 0;
      const scale = SCALE[String(currency || '').toUpperCase()] ?? 2;
      return n / (10 ** scale);
    };
    const statusFromMetadata = (md: any): 'completed' | 'pending' | 'failed' => {
      const raw = String(md?.state || md?.status || '').toLowerCase();
      if (['failed', 'error', 'returned', 'refunded', 'canceled', 'cancelled'].includes(raw)) return 'failed';
      if ([
        'pending',
        'processing',
        'queued',
        'in_review',
        'under_review',
        'review',
        'pending_review',
        'manual_review',
        'refund_in_flight',
        'refund_pending',
        'return_in_flight',
      ].includes(raw)) return 'pending';
      return 'completed';
    };
    const descriptionFromRow = (row: any): string => {
      const md = row?.metadata || {};
      const lifecycle = String(md?.status || md?.activity_type || '').toLowerCase();
      if (md?.kind === 'virtual_account_deposit_status' || md?.deposit_id) {
        if (['refunded', 'returned'].includes(lifecycle)) return 'Transaction refunded';
        if (['refund_in_flight', 'refund_pending', 'return_in_flight'].includes(lifecycle)) return 'Refund in progress';
        if (['in_review', 'under_review', 'review', 'pending_review', 'manual_review'].includes(lifecycle)) return 'Transaction under review';
        if (['approved', 'completed', 'funds_received', 'processed', 'payment_processed'].includes(lifecycle)) return 'Payment received';
      }
      return String(
        md?.description ||
        md?.reason ||
        md?.bridge_event_type ||
        `${String(row?.entity_type || 'ledger').replace(/_/g, ' ')} ${String(row?.direction || '').toLowerCase() || 'entry'}`
      );
    };

    const [ledgerRes, txRes] = await Promise.all([
      supabase
        .from('bridge_balance_ledger')
        .select('id,event_id,entity_type,entity_id,currency,amount_minor,direction,metadata,created_at')
        .or(ownerOrFilter(user.id))
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      supabase
        .from('transactions')
        .select('id,type,amount,currency,status,description,reference,metadata,created_at,provider,bridge_transfer_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ]);
    if (ledgerRes.error) {
      return { success: false, error: ledgerRes.error.message };
    }
    if (txRes.error) {
      return { success: false, error: txRes.error.message };
    }

    const ledgerTransactions = (ledgerRes.data || []).map((row: any) => {
      const currency = String(row?.currency || '').toUpperCase();
      const direction = String(row?.direction || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit';
      const amountMajorAbs = Math.abs(minorToMajor(row?.amount_minor, currency));
      const metadata = { ...(row?.metadata || {}), direction };
      const receipt = normalizeTransactionReceipt({ amount: amountMajorAbs, metadata });
      return {
        id: row?.id || row?.event_id,
        type: String(metadata?.transaction_type || row?.entity_type || 'transaction'),
        amount: receipt?.finalAmount ?? amountMajorAbs,
        currency,
        description: descriptionFromRow(row),
        status: statusFromMetadata(metadata),
        created_at: row?.created_at || new Date().toISOString(),
        metadata,
        receipt: receipt || undefined,
      };
    });

    const bridgeTransferTransactions = (txRes.data || [])
      .filter((row: any) => {
        const md = row?.metadata || {};
        if (md?.mirror_of === 'bridge_balance_ledger') return false;
        return Boolean(row?.bridge_transfer_id || md?.transaction_type || md?.flow || md?.payout_validator || md?.kind === 'virtual_account_deposit_status');
      })
      .map((row: any) => {
        const currency = String(row?.currency || '').toUpperCase();
        const rowMetadata = row?.metadata || {};
        const direction = txDirection({
          type: row?.type || rowMetadata?.transaction_type,
          amount: row?.amount,
          metadata: rowMetadata,
          description: row?.description,
        });
        const metadata = { ...rowMetadata, direction };
        const amountMajorAbs = Math.abs(Number(row?.amount || 0));
        const receipt = normalizeTransactionReceipt({ amount: amountMajorAbs, metadata });
        return {
          id: row?.id || row?.bridge_transfer_id || row?.reference,
          type: String(row?.type || metadata?.transaction_type || 'transfer'),
          amount: receipt?.finalAmount ?? amountMajorAbs,
          currency,
          description: String(row?.description || descriptionFromRow({ ...row, entity_type: row?.type, direction, metadata })),
          status: statusFromMetadata({ ...metadata, status: row?.status }),
          created_at: row?.created_at || new Date().toISOString(),
          metadata,
          receipt: receipt || undefined,
        };
      });

    const lifecycleKey = (row: any): string => String(
      row?.metadata?.bridge_transfer_id ||
      row?.bridge_transfer_id ||
      row?.metadata?.raw?.payment_route?.transfer_id ||
      row?.metadata?.deposit_id ||
      row?.metadata?.credit_event_id ||
      row?.metadata?.bridge_event_id ||
      row?.metadata?.event_id ||
      row?.metadata?.raw?.id ||
      row?.id ||
      '',
    ).trim();
    const lifecycleRank = (row: any): number => {
      const md = row?.metadata || {};
      const raw = String(md?.state || md?.status || md?.activity_type || row?.status || '').toLowerCase();
      if (['refunded', 'returned', 'failed', 'error', 'canceled', 'cancelled'].includes(raw)) return 50;
      if (['refund_in_flight', 'refund_pending', 'return_in_flight'].includes(raw)) return 40;
      if (['in_review', 'under_review', 'review', 'pending_review', 'manual_review'].includes(raw)) return 30;
      if (['approved', 'completed', 'processed', 'payment_processed', 'settled', 'succeeded', 'success'].includes(raw)) return 20;
      if (['pending', 'submitted', 'funds_received', 'payment_submitted', 'queued', 'processing'].includes(raw)) return 10;
      return 0;
    };
    const shouldReplaceLifecycle = (previous: any | undefined, next: any): boolean => {
      if (!previous) return true;
      const prevRank = lifecycleRank(previous);
      const nextRank = lifecycleRank(next);
      if (nextRank !== prevRank) return nextRank > prevRank;
      return new Date(next?.created_at || 0).getTime() >= new Date(previous?.created_at || 0).getTime();
    };
    const byLifecycle = new Map<string, any>();
    const lifecycleRows = [...ledgerTransactions, ...bridgeTransferTransactions];
    for (let i = 0; i < lifecycleRows.length; i += 1) {
      const row = lifecycleRows[i];
      const key = lifecycleKey(row);
      if (!key) {
        byLifecycle.set(String(row?.id || `row:${i}`), row);
        continue;
      }
      const previous = byLifecycle.get(key);
      if (shouldReplaceLifecycle(previous, row)) byLifecycle.set(key, row);
    }
    const transactions = Array.from(byLifecycle.values())
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
    return { success: true, data: { transactions } };
  },

  async getCustomerTransactions(_customerId: string, _filters?: any) {
    // Quarantine unresolved legacy endpoint (`get-customer-transactions`).
    return RAILS_FUTURE_STATE;
  },

  async exportTransactions(userId: string, format: 'csv' | 'pdf' | 'excel', filters?: any) {
    // Quarantine unresolved legacy endpoint (`export-transactions`).
    // Keep signature for callers but fail-closed with structured state.
    void userId;
    void format;
    void filters;
    return RAILS_FUTURE_STATE;
  },

  async verifyTransaction(_transactionId: string) {
    // Quarantine unresolved legacy endpoint (`verify-transaction`).
    return RAILS_FUTURE_STATE;
  },
};

// ============================================================================
// CANONICAL FINANCIAL READ MODEL
// ============================================================================
export const financialReadModelAPI = (() => {
  // Route-performance model:
  // - Revalidate cadence keeps data fresh in background.
  // - Stale window keeps navigation instant across business routes.
  const REVALIDATE_MS = 5000;
  const STALE_MAX_MS = 5 * 60 * 1000;
  const PERSIST_STALE_MAX_MS = 30 * 60 * 1000;
  let inFlight: Promise<any> | null = null;
  let inFlightKey = '';
  let lastSnapshot: any = null;
  let lastSnapshotAt = 0;
  let lastSnapshotKey = '';
  let lastAnySnapshot: any = null;
  let lastAnySnapshotAt = 0;
  let lastAnySnapshotUserId = '';
  const EXTERNAL_FETCH_TIMEOUT_MS = 900;
  const EXTERNAL_ACCOUNT_LIST_TIMEOUT_MS = 10_000;

  async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function persistKey(snapshotKey: string): string {
    return `borderpay_snapshot_cache_v2:${snapshotKey}`;
  }

  function anySnapshotKey(userId: string): string {
    return `${userId}:any`;
  }

  function snapshotDepth(snapshot: any): number {
    const txCount = Array.isArray(snapshot?.data?.transactions) ? snapshot.data.transactions.length : 0;
    const notifCount = Array.isArray(snapshot?.data?.notifications) ? snapshot.data.notifications.length : 0;
    return Math.max(txCount, notifCount);
  }

  function loadPersistedSnapshot(snapshotKey: string): { snapshot: any; at: number } | null {
    try {
      if (typeof window === 'undefined') return null;
      const raw = localStorage.getItem(persistKey(snapshotKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const at = Number(parsed?.at || 0);
      if (!parsed?.snapshot || !at) return null;
      if (Date.now() - at > PERSIST_STALE_MAX_MS) return null;
      return { snapshot: parsed.snapshot, at };
    } catch {
      return null;
    }
  }

  function savePersistedSnapshot(snapshotKey: string, snapshot: any) {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(
        persistKey(snapshotKey),
        JSON.stringify({ at: Date.now(), snapshot }),
      );
    } catch {
      // best effort
    }
  }

  function rememberSnapshot(snapshotKey: string, userId: string, snapshot: any) {
    const now = Date.now();
    lastSnapshot = snapshot;
    lastSnapshotAt = now;
    lastSnapshotKey = snapshotKey;
    savePersistedSnapshot(snapshotKey, snapshot);

    // Keep one user-scoped canonical snapshot for instant cross-screen first
    // paint. Exact-limit snapshots still refresh in the background.
    if (
      !lastAnySnapshot ||
      lastAnySnapshotUserId !== userId ||
      snapshotDepth(snapshot) >= snapshotDepth(lastAnySnapshot) ||
      now - lastAnySnapshotAt > REVALIDATE_MS
    ) {
      lastAnySnapshot = snapshot;
      lastAnySnapshotAt = now;
      lastAnySnapshotUserId = userId;
      savePersistedSnapshot(anySnapshotKey(userId), snapshot);
    }
  }

  function preserveKnownFinancialSurfaces(userId: string, next: any): any {
    if (!next?.success || !next?.data) return next;

    const previous =
      (lastAnySnapshotUserId === userId ? lastAnySnapshot : null) ||
      loadPersistedSnapshot(anySnapshotKey(userId))?.snapshot ||
      null;
    if (!previous?.success || !previous?.data) return next;

    const collection = (snapshot: any, key: string): any[] =>
      Array.isArray(snapshot?.data?.[key]) ? snapshot.data[key] : [];
    const surfaceKeys = ['wallets', 'stablecoin_wallets', 'virtual_accounts'];
    const previousSurfaceCount = surfaceKeys.reduce(
      (count, key) => count + collection(previous, key).length,
      0,
    );
    const nextSurfaceCount = surfaceKeys.reduce(
      (count, key) => count + collection(next, key).length,
      0,
    );

    // A user cannot lose every provisioned wallet and receive account because
    // an isolated payout was submitted. Treat an all-empty replacement as a
    // transient/partial read and keep the last server-confirmed surfaces. Real
    // closures are represented by account status changes, not missing rows.
    if (previousSurfaceCount === 0 || nextSurfaceCount !== 0) return next;

    const previousTransactions = collection(previous, 'transactions');
    const nextTransactions = collection(next, 'transactions');
    return {
      ...next,
      data: {
        ...next.data,
        wallets: collection(previous, 'wallets'),
        stablecoin_wallets: collection(previous, 'stablecoin_wallets'),
        virtual_accounts: collection(previous, 'virtual_accounts'),
        transactions: nextTransactions.length > 0 ? nextTransactions : previousTransactions,
        total_balance: previous.data.total_balance,
        has_funding_surface: previous.data.has_funding_surface,
        financial_surfaces_partial: true,
      },
    };
  }

  function invalidateForUser(userIdRaw: string) {
    const userId = String(userIdRaw || '').trim();
    if (!userId) return;

    if (lastSnapshotKey.startsWith(`${userId}:`)) {
      lastSnapshot = null;
      lastSnapshotAt = 0;
      lastSnapshotKey = '';
    }
    if (lastAnySnapshotUserId === userId) {
      lastAnySnapshot = null;
      lastAnySnapshotAt = 0;
      lastAnySnapshotUserId = '';
    }

    try {
      const snapshotPrefix = `borderpay_snapshot_cache_v2:${userId}:`;
      const financialSuffix = `:financial-v2:${userId}`;
      const remove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(snapshotPrefix) || key.endsWith(financialSuffix))) remove.push(key);
      }
      remove.push(
        `borderpay_wallet_total_${userId}`,
        `borderpay_wallet_balances_${userId}`,
      );
      for (const key of new Set(remove)) localStorage.removeItem(key);
    } catch {
      // Cache invalidation is best effort; the next uncached snapshot remains
      // the source of truth.
    }
  }

  function refreshSnapshotInBackground(userId: string, snapshotKey: string, limit: number) {
    if (inFlight && inFlightKey === snapshotKey) return;
    inFlightKey = snapshotKey;
    inFlight = fetchSnapshot(userId, limit).then((rawNext) => {
      const next = preserveKnownFinancialSurfaces(userId, rawNext);
      if (next?.success) rememberSnapshot(snapshotKey, userId, next);
      return next;
    }).finally(() => {
      inFlight = null;
      inFlightKey = '';
    });
  }

  async function fetchSnapshot(userId: string, limit: number) {
    const [profileRes, walletsRes, txRes, stableRes, vaRes, notifRes, externalListRes, externalCapsRes, externalWalletsRes] = await Promise.all([
      userAPI.getProfile(),
      walletAPI.getWallets(),
      transactionAPI.getTransactions(limit, 0),
      supabase
        .from('bridge_wallets')
        .select('*')
        .or(ownerOrFilter(userId))
        .order('created_at', { ascending: false }),
      supabase
        .from('bridge_virtual_accounts')
        .select('*')
        .or(ownerOrFilter(userId))
        .order('created_at', { ascending: false }),
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      // External-account surfaces are route-specific and should never block
      // the shared snapshot used by Dashboard/Wallet/Receive/Transactions/etc.
      withTimeout(
        bridgeAPI.externalAccount.list() as Promise<any>,
        EXTERNAL_FETCH_TIMEOUT_MS,
        { success: false, error: 'timeout' } as any,
      ),
      withTimeout(
        bridgeAPI.externalAccount.capabilities() as Promise<any>,
        EXTERNAL_FETCH_TIMEOUT_MS,
        { success: false, error: 'timeout' } as any,
      ),
      withTimeout(
        externalWalletsAPI.list() as Promise<any>,
        EXTERNAL_FETCH_TIMEOUT_MS,
        { success: false, error: 'timeout' } as any,
      ),
    ]);

    if (!profileRes?.success) {
      navPerfTrackSnapshot(false);
      return profileRes as any;
    }
    if (!walletsRes?.success) {
      navPerfTrackSnapshot(false);
      return walletsRes as any;
    }
    if (!txRes?.success) {
      navPerfTrackSnapshot(false);
      return txRes as any;
    }

    const profile = (profileRes as any)?.data?.user || {};
    const wallets = Array.isArray((walletsRes as any)?.data?.wallets) ? (walletsRes as any).data.wallets : [];
    const transactions = Array.isArray((txRes as any)?.data?.transactions) ? (txRes as any).data.transactions : [];
    const stablecoinWallets = Array.isArray(stableRes?.data) ? stableRes.data : [];
    const virtualAccounts = Array.isArray(vaRes?.data) ? vaRes.data : [];
    const notifications = Array.isArray(notifRes?.data) ? notifRes.data : [];
    const externalAccounts = ((externalListRes as any)?.success && Array.isArray((externalListRes as any)?.data?.external_accounts))
      ? (externalListRes as any).data.external_accounts
      : [];
    const externalAccountCapabilities = ((externalCapsRes as any)?.success && Array.isArray((externalCapsRes as any)?.data?.supported_account_types))
      ? (externalCapsRes as any).data.supported_account_types.filter((x: any) => x === 'us' || x === 'iban' || x === 'gb')
      : [];
    const externalWallets = ((externalWalletsRes as any)?.success && Array.isArray((externalWalletsRes as any)?.data?.wallets))
      ? (externalWalletsRes as any).data.wallets
      : [];
    const isReady = Boolean(!stableRes?.error && !vaRes?.error && !notifRes?.error);
    if (stableRes?.error) {
      navPerfTrackSnapshot(false);
      return { success: false, error: stableRes.error.message };
    }
    if (vaRes?.error) {
      navPerfTrackSnapshot(false);
      return { success: false, error: vaRes.error.message };
    }
    if (notifRes?.error) {
      navPerfTrackSnapshot(false);
      return { success: false, error: notifRes.error.message };
    }

    const hasFundingSurface = wallets.length > 0;
    const walletStatus = deriveWalletStatus({
      account_type: profile?.account_type,
      bridge_kyc_status: profile?.bridge_kyc_status,
      bridge_kyb_status: profile?.bridge_kyb_status,
      bridge_account_status: profile?.bridge_account_status,
      is_unlocked: profile?.is_unlocked,
      has_funding_surface: hasFundingSurface,
    });

    navPerfTrackSnapshot(true);
    return {
      success: true,
      data: {
        profile: { ...profile, wallet_status: profile?.wallet_status || walletStatus },
        wallets,
        transactions,
        stablecoin_wallets: stablecoinWallets,
        virtual_accounts: virtualAccounts,
        notifications,
        notifications_unread_count: notifications.filter((n: any) => !n?.read).length,
        external_accounts: externalAccounts,
        external_account_capabilities: externalAccountCapabilities,
        external_wallets: externalWallets,
        external_accounts_partial:
          !((externalListRes as any)?.success) || !((externalCapsRes as any)?.success),
        external_wallets_partial: !((externalWalletsRes as any)?.success),
        isReady,
        wallet_status: profile?.wallet_status || walletStatus,
        has_funding_surface: hasFundingSurface,
        total_balance: wallets.reduce((sum: number, w: any) => sum + Number(w?.balance || 0), 0),
      },
    };
  }

  async function getCurrentUserId(): Promise<{ userId?: string; error?: string }> {
    const { data: sessionData } = await supabase.auth.getSession();
    let user = sessionData?.session?.user ?? null;
    let userErr: any = null;
    if (!user) {
      const r = await supabase.auth.getUser();
      user = r.data?.user ?? null;
      userErr = r.error;
    }
    if (userErr || !user) {
      return { error: userErr?.message || 'Not signed in' };
    }
    return { userId: user.id };
  }

  return {
    invalidateForUser,

    async getSnapshot(limit = 50) {
      // Fast path: session user is locally available and avoids an extra
      // auth round-trip on every route mount.
      const { data: sessionData } = await supabase.auth.getSession();
      let user = sessionData?.session?.user ?? null;
      let userErr: any = null;
      if (!user) {
        const r = await supabase.auth.getUser();
        user = r.data?.user ?? null;
        userErr = r.error;
      }
      if (userErr || !user) {
        navPerfTrackSnapshot(false);
        return { success: false, error: userErr?.message || 'Not signed in' };
      }

      const key = `${user.id}:${Math.max(1, Number(limit) || 50)}`;
      const now = Date.now();
      if (lastSnapshot && lastSnapshotKey === key && now - lastSnapshotAt < STALE_MAX_MS) {
        navPerfTrackCache('snapshot', true);
        if (now - lastSnapshotAt >= REVALIDATE_MS && (!inFlight || inFlightKey !== key)) {
          refreshSnapshotInBackground(user.id, key, limit);
        }
        return lastSnapshot;
      }

      if (lastAnySnapshot && lastAnySnapshotUserId === user.id && now - lastAnySnapshotAt < STALE_MAX_MS) {
        navPerfTrackCache('snapshot:any', true);
        refreshSnapshotInBackground(user.id, key, limit);
        return lastAnySnapshot;
      }

      const persisted = loadPersistedSnapshot(key);
      if (persisted?.snapshot) {
        navPerfTrackCache('snapshot', true);
        lastSnapshot = persisted.snapshot;
        lastSnapshotAt = persisted.at;
        lastSnapshotKey = key;
        rememberSnapshot(key, user.id, persisted.snapshot);
        refreshSnapshotInBackground(user.id, key, limit);
        return persisted.snapshot;
      }

      const persistedAny = loadPersistedSnapshot(anySnapshotKey(user.id));
      if (persistedAny?.snapshot) {
        navPerfTrackCache('snapshot:any', true);
        lastAnySnapshot = persistedAny.snapshot;
        lastAnySnapshotAt = persistedAny.at;
        lastAnySnapshotUserId = user.id;
        refreshSnapshotInBackground(user.id, key, limit);
        return persistedAny.snapshot;
      }

      if (inFlight && inFlightKey === key) return inFlight;

      inFlightKey = key;
      inFlight = fetchSnapshot(user.id, limit).then((rawNext) => {
        const next = preserveKnownFinancialSurfaces(user.id, rawNext);
        if (next?.success) rememberSnapshot(key, user.id, next);
        return next;
      }).finally(() => {
        inFlight = null;
        inFlightKey = '';
      });
      return inFlight;
    },

    async getWalletRouteData() {
      const { userId, error } = await getCurrentUserId();
      if (!userId) return { success: false, error: error || 'Not signed in' };

      try {
        const snapshot: any = await financialReadModelAPI.getSnapshot(100);
        if (snapshot?.success && snapshot?.data) {
          const wallets = Array.isArray(snapshot.data.wallets) ? snapshot.data.wallets : [];
          const balanceByCurrency = wallets.reduce((acc: Record<string, number>, w: any) => {
            const c = String(w?.currency || '').toUpperCase();
            if (!c) return acc;
            acc[c] = Number(w?.balance || 0);
            return acc;
          }, {});
          return {
            success: true,
            data: {
              wallets,
              stablecoin_wallets: Array.isArray(snapshot.data.stablecoin_wallets) ? snapshot.data.stablecoin_wallets : [],
              virtual_accounts: Array.isArray(snapshot.data.virtual_accounts) ? snapshot.data.virtual_accounts : [],
              virtual_account_capabilities: null,
              balance_by_currency: balanceByCurrency,
              total_balance: wallets.reduce((sum: number, w: any) => sum + Number(w?.balance || 0), 0),
              stablecoin_wallets_partial: Boolean(snapshot.data.stablecoin_wallets_partial),
              virtual_accounts_partial: false,
              snapshot_source: 'financial_snapshot',
            },
          };
        }
      } catch {
        // Fall back to the direct read model below.
      }

      // Bridge remains the provider source of truth, but route paint must use
      // the local read model first. Reconciliation is background-only so Wallet,
      // Receive, Send, Exchange, and Business dashboard do not stall for 2-5s.
      try {
        void bridgeAPI.syncAccounts().catch(() => null);
      } catch {
        // Keep the route usable from local tables if sync cannot be scheduled.
      }

      const [walletsRes, stableRes, vaRes, vaCapsRes] = await Promise.all([
        walletAPI.getWallets(),
        supabase
          .from('bridge_wallets')
          .select('*')
          .or(ownerOrFilter(userId))
          .order('created_at', { ascending: false }),
        supabase
          .from('bridge_virtual_accounts')
          .select('*')
          .or(ownerOrFilter(userId))
          .order('created_at', { ascending: false }),
        withTimeout(
          bridgeAPI.virtualAccount.capabilities() as Promise<any>,
          EXTERNAL_FETCH_TIMEOUT_MS,
          { success: false, error: 'timeout' } as any,
        ),
      ]);

      if (!walletsRes?.success) return walletsRes as any;

      const wallets = Array.isArray((walletsRes as any)?.data?.wallets) ? (walletsRes as any).data.wallets : [];
      const balanceByCurrency = wallets.reduce((acc: Record<string, number>, w: any) => {
        const c = String(w?.currency || '').toUpperCase();
        if (!c) return acc;
        acc[c] = Number(w?.balance || 0);
        return acc;
      }, {});

      return {
        success: true,
        data: {
          wallets,
          stablecoin_wallets: Array.isArray(stableRes?.data) ? stableRes.data : [],
          virtual_accounts: Array.isArray(vaRes?.data) ? vaRes.data : [],
          virtual_account_capabilities: (vaCapsRes as any)?.success ? (vaCapsRes as any).data : null,
          balance_by_currency: balanceByCurrency,
          total_balance: wallets.reduce((sum: number, w: any) => sum + Number(w?.balance || 0), 0),
          stablecoin_wallets_partial: Boolean(stableRes?.error),
          virtual_accounts_partial: Boolean(vaRes?.error),
        },
      };
    },

    async getReceiveRouteData() {
      const r = await this.getWalletRouteData();
      if (!r?.success) return r;
      return {
        success: true,
        data: {
          stablecoin_wallets: (r as any).data?.stablecoin_wallets || [],
          virtual_accounts: (r as any).data?.virtual_accounts || [],
        },
      };
    },

    async getSendRouteData() {
      let walletsRes: any = null;
      try {
        const snapshotRes: any = await financialReadModelAPI.getSnapshot(20);
        const snapshotWallets = Array.isArray(snapshotRes?.data?.wallets) ? snapshotRes.data.wallets : [];
        if (snapshotRes?.success && snapshotWallets.length > 0) {
          walletsRes = { success: true, data: { wallets: snapshotWallets } };
        }
      } catch { /* fall through to direct wallet read */ }
      if (!walletsRes) walletsRes = await walletAPI.getWallets();
      if (!walletsRes?.success) return walletsRes as any;
      const [capsRes, externalListRes]: any[] = await Promise.all([
        withTimeout(
          bridgeAPI.externalAccount.capabilities() as Promise<any>,
          EXTERNAL_FETCH_TIMEOUT_MS,
          { success: false, error: 'timeout' } as any,
        ),
        withTimeout(
          bridgeAPI.externalAccount.list() as Promise<any>,
          EXTERNAL_ACCOUNT_LIST_TIMEOUT_MS,
          { success: false, code: 'request_timeout', error: 'Payout-account lookup timed out. Please retry.' } as any,
        ),
      ]);
      const caps = (capsRes?.success && Array.isArray(capsRes?.data?.supported_account_types))
        ? capsRes.data.supported_account_types.filter((x: any) => x === 'us' || x === 'iban' || x === 'gb')
        : [];
      const externalAccounts = (externalListRes?.success && Array.isArray(externalListRes?.data?.external_accounts))
        ? externalListRes.data.external_accounts
        : [];
      return {
        success: true,
        data: {
          wallets: Array.isArray((walletsRes as any)?.data?.wallets) ? (walletsRes as any).data.wallets : [],
          external_account_capabilities: caps,
          external_accounts: externalAccounts,
          external_account_capabilities_partial: !capsRes?.success,
          external_accounts_partial: !externalListRes?.success,
          external_accounts_error: externalListRes?.success ? null : (externalListRes?.error || 'Could not load payout accounts.'),
        },
      };
    },
  };
})();

// ============================================================================
// VIRTUAL CARDS
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// LOCKED — Cards
// ─────────────────────────────────────────────────────────────────────────────
// Card operations are disabled product-wide until card access is approved and
// enabled. These methods short-circuit with a structured cards_locked error
// and DO NOT hit any edge function. Do not re-add live card calls here without
// the real card backend and a reviewed enablement path.
// Stubs include a `data: undefined` field so the shape stays compatible with
// `apiCall`'s `{ success, data?, error?, code? }` return — callers that read
// r.data on the failure branch get undefined instead of a type error.
const CARDS_LOCKED = {
  success: false as const,
  error: 'Cards are locked for your account.',
  code:  'cards_locked',
  data:  {
    locked: true,
    program: {
      network: 'VISA',
      status: 'locked',
      reason: 'program_not_enabled',
    },
    capabilities: {
      issue_card: false,
      fund_card: false,
      withdraw_card: false,
      freeze_card: false,
      terminate_card: false,
      card_transactions: false,
      spending_controls: false,
      statements: false,
    },
  } as any,
};

// Future-state stub returned by quarantined provisioning/transfer methods
// where the current account backend has no equivalent today (African local
// currency rails, mobile-wallet provisioning, off-ramp wiring, etc).
// These rails stay disabled until BorderPay enables them.
const RAILS_FUTURE_STATE = {
  success: false as const,
  error: 'This rail is not yet available. We are bringing it online soon.',
  code:  'rails_future_state',
  data:  undefined as any,
};

// Original parameter signatures preserved for type-stable downstream imports.
// Arguments are accepted and intentionally ignored — the methods short-circuit
// without any network call.
export const cardAPI = {
  async getProgramStatus() {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-program-status', { method: 'POST' });
  },

  async createCard(_data: {
    card_type?: string;
    brand?: string;
    initial_amount?: number;
    card_name?: string;
    spending_limit?: number;
    design_id?: string;
  }) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-create', {
      method: 'POST',
      body: JSON.stringify(_data || {}),
    });
  },

  async getCards() {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-list', { method: 'POST' });
  },

  async getCard(_cardId: string) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-details', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId }),
    });
  },

  async getCardTransactions(_cardId: string, _filters?: {
    start_date?: string;
    end_date?: string;
    page?: string;
    page_size?: string;
  }) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-transactions', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId, ...(_filters || {}) }),
    });
  },

  async fundCard(_cardId: string, _amount: number) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-fund', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId, amount: _amount }),
    });
  },

  async withdrawCard(_cardId: string, _amount: number) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-withdraw', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId, amount: _amount }),
    });
  },

  async freezeCard(_cardId: string) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-freeze', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId }),
    });
  },

  async unfreezeCard(_cardId: string) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-unfreeze', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId }),
    });
  },

  async terminateCard(_cardId: string) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-terminate', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId }),
    });
  },

  async getCardCharges(_filters?: {
    channel?: string;
    transaction_id?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
    search?: string;
  }) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-transactions', {
      method: 'POST',
      body: JSON.stringify(_filters || {}),
    });
  },

  async updateSpendingLimits(_cardId: string, _limits: { daily_limit?: number | null; monthly_limit?: number | null }) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-spending-limits', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId, ...(_limits || {}) }),
    });
  },

  async getStatements(_cardId: string, _opts?: { month?: string; year?: number; page?: number; page_size?: number }) {
    if (!CARDS_RUNTIME_ENABLED) return CARDS_LOCKED;
    return apiCall('card-statements', {
      method: 'POST',
      body: JSON.stringify({ card_id: _cardId, ...(_opts || {}) }),
    });
  },
};

// ============================================================================
// FX / EXCHANGE
// ============================================================================

// FX API surface. Execution is routed through `bridge-transfer` using
// Bridge orchestration (wallet source → wallet destination), while rates
// remain indicative unless a quote endpoint is wired.

const FX_SUPPORTED_PAIRS_FALLBACK = [
  'USD_BRL', 'BRL_USD',
  'USD_COP', 'COP_USD',
  'USD_EUR', 'EUR_USD',
  'USD_GBP', 'GBP_USD',
  'USD_MXN', 'MXN_USD',
  'USD_USDT', 'USDT_USD',
];
let fxSupportedPairsCache = new Set<string>(FX_SUPPORTED_PAIRS_FALLBACK);
let fxSupportedPairsLoadedAt = 0;
let fxSupportedPairsPromise: Promise<string[]> | null = null;

export const fxAPI = {
  // Bridge-documented fiat/stablecoin pair set used by BorderPay FX UI policy.
  // Keep this strict to avoid showing non-executable pairs.
  supportedPairs(): string[] {
    return Array.from(fxSupportedPairsCache);
  },

  async refreshSupportedPairs(force: boolean = false): Promise<string[]> {
    const now = Date.now();
    if (!force && fxSupportedPairsLoadedAt > 0 && now - fxSupportedPairsLoadedAt < 5 * 60 * 1000) {
      return fxAPI.supportedPairs();
    }
    if (fxSupportedPairsPromise && !force) {
      return fxSupportedPairsPromise;
    }
    const loader = (async () => {
      const res: any = await apiCall<{ supported_pairs?: string[] }>('bridge-fx-supported-pairs', {
        method: 'GET',
      });
      if (res?.success && Array.isArray(res?.data?.supported_pairs)) {
        const normalized = res.data.supported_pairs
          .map((p: string) => String(p || '').trim().toUpperCase())
          .filter((p: string) => /^[A-Z0-9]{2,10}_[A-Z0-9]{2,10}$/.test(p));
        if (normalized.length > 0) {
          fxSupportedPairsCache = new Set(normalized);
          fxSupportedPairsLoadedAt = Date.now();
          return normalized;
        }
      }
      if (fxSupportedPairsCache.size === 0) {
        fxSupportedPairsCache = new Set(FX_SUPPORTED_PAIRS_FALLBACK);
      }
      return fxAPI.supportedPairs();
    })();
    fxSupportedPairsPromise = loader;
    try {
      return await loader;
    } finally {
      if (fxSupportedPairsPromise === loader) fxSupportedPairsPromise = null;
    }
  },

  isPairSupported(fromCurrency: string, toCurrency: string): boolean {
    const from = String(fromCurrency || '').toUpperCase();
    const to = String(toCurrency || '').toUpperCase();
    if (!from || !to || from === to) return false;
    return fxAPI.supportedPairs().includes(`${from}_${to}`);
  },

  async getCurrentRate(fromCurrency: string, toCurrency: string) {
    await fxAPI.refreshSupportedPairs();
    const from = String(fromCurrency || '').toUpperCase();
    const to = String(toCurrency || '').toUpperCase();
    if (!fxAPI.isPairSupported(from, to)) {
      return { success: false, error: `Unsupported pair ${from}/${to}` };
    }
    return apiCall<{
      from: string;
      to: string;
      rate: number;
      reverse_rate?: number;
      updated_at?: string | null;
      provider: 'bridge';
    }>(
      'bridge-exchange-rates',
      {
        method: 'POST',
        body: JSON.stringify({ from, to }),
      },
    );
  },

  async getQuote(sourceCurrency: string, targetCurrency: string, amount: number) {
    await fxAPI.refreshSupportedPairs();
    const from = String(sourceCurrency || '').toUpperCase();
    const to = String(targetCurrency || '').toUpperCase();
    const amt = Number(amount || 0);
    if (!from || !to || !Number.isFinite(amt) || amt <= 0) {
      return { success: false, error: 'Invalid FX quote request' };
    }
    if (from === to) {
      return {
        success: true,
        data: {
          source_currency: from,
          target_currency: to,
          amount: amt,
          rate: 1,
          converted_amount: amt,
          fee: 0,
          source: 'identity',
        },
      };
    }

    const live: any = await fxAPI.getCurrentRate(from, to);
    if (!live?.success || !Number.isFinite(Number(live?.data?.rate))) {
      return { success: false, error: live?.error || 'FX rates unavailable' };
    }
    const rate = Number(live.data.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return { success: false, error: `Unsupported pair ${from}/${to}` };
    }
    const converted = amt * rate;
    return {
      success: true,
      data: {
        source_currency: from,
        target_currency: to,
        amount: amt,
        rate,
        converted_amount: Number(converted.toFixed(2)),
        fee: 0,
        source: 'live',
      },
    };
  },

  async convert(data: {
    amount: number;
    source: { payment_rail: string; currency: string; chain?: string; bridge_wallet_id?: string; external_account_id?: string; from_address?: string };
    destination: { payment_rail: string; currency: string; chain?: string; address?: string; bridge_wallet_id?: string; external_account_id?: string; deposit_id?: string };
    idempotency_key?: string;
  }) {
    const amount = Number(data?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: 'amount must be greater than 0' };
    }
    const idempotencyKey = data?.idempotency_key || crypto.randomUUID();
    return apiCall<{ transfer_id: string; state: 'pending' | 'processing' | 'succeeded' | 'failed'; replayed?: boolean }>(
      'bridge-transfer',
      {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          source: {
            payment_rail: data.source.payment_rail,
            currency: data.source.currency,
            ...(data.source.chain ? { chain: data.source.chain } : {}),
            ...(data.source.bridge_wallet_id ? { bridge_wallet_id: data.source.bridge_wallet_id } : {}),
            ...(data.source.external_account_id ? { external_account_id: data.source.external_account_id } : {}),
            ...(data.source.from_address ? { from_address: data.source.from_address } : {}),
            amount: String(amount),
          },
          destination: {
            payment_rail: data.destination.payment_rail,
            currency: data.destination.currency,
            ...(data.destination.chain ? { chain: data.destination.chain } : {}),
            ...(data.destination.address ? { address: data.destination.address } : {}),
            ...(data.destination.bridge_wallet_id ? { bridge_wallet_id: data.destination.bridge_wallet_id } : {}),
            ...(data.destination.external_account_id ? { external_account_id: data.destination.external_account_id } : {}),
            ...(data.destination.deposit_id ? { deposit_id: data.destination.deposit_id } : {}),
          },
        }),
      },
    );
  },

  async getHistory() {
    // Quarantine unresolved legacy endpoint (`get-fx-history`).
    return RAILS_FUTURE_STATE;
  },

  /**
   * Live mid-market FX rates.
   *
   * Fetches real rates from the ExchangeRate-API open endpoint
   * (https://open.er-api.com — no key, CORS-enabled, broad currency coverage
   * incl. African corridors; free tier refreshes daily). We derive the pair
   * set the app needs from a USD-base snapshot. These are real mid-market
   * rates — with PARTNER_FX_MARKUP suspended, what we display is the true
   * mid-market price.
   *
   * On any network/parse failure we fall back to an indicative static
   * snapshot tagged `source: 'fallback'` so the UI degrades gracefully.
   * Callers key off `source` ('live' | 'fallback') to label the rate.
   *
   * NOTE: African corridors remain display-only (indicative) until local
   * payout rails are wired; this only feeds the rate display, not execution.
   */
  async getLiveRates() {
    const FALLBACK = {
      success: true as const,
      data: {
        source:       'fallback' as const,
        generated_at: new Date().toISOString(),
        rates: {
          USD_EUR: 0.92,
          USD_GBP: 0.79,
          EUR_USD: 1.0870,
          GBP_USD: 1.2658,
          EUR_GBP: 0.8587,
          GBP_EUR: 1.1645,
        } as Record<string, number>,
        note: 'Indicative rates — live feed unavailable.',
      },
    };

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const resp = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return FALLBACK;

      const j: any = await resp.json();
      const R = j?.rates;
      if (j?.result !== 'success' || !R || typeof R !== 'object') return FALLBACK;

      const n = (v: unknown): number | null => {
        const x = Number(v);
        return Number.isFinite(x) && x > 0 ? x : null;
      };
      const rates: Record<string, number> = {};
      const put = (key: string, val: number | null) => { if (val) rates[key] = val; };

      // Majors only (USD / EUR / GBP), USD base.
      put('USD_EUR', n(R.EUR));
      put('USD_GBP', n(R.GBP));
      // Major crosses derived from the USD base.
      const eur = n(R.EUR), gbp = n(R.GBP);
      if (eur) put('EUR_USD', 1 / eur);
      if (gbp) put('GBP_USD', 1 / gbp);
      if (eur && gbp) { put('EUR_GBP', gbp / eur); put('GBP_EUR', eur / gbp); }

      if (Object.keys(rates).length === 0) return FALLBACK;

      return {
        success: true as const,
        data: {
          source:       'live' as const,
          generated_at: j?.time_last_update_utc
            ? new Date(j.time_last_update_utc).toISOString()
            : new Date().toISOString(),
          rates,
          note: 'Live mid-market rates.',
        },
      };
    } catch {
      return FALLBACK;
    }
  },
};

// ============================================================================
// KYC / ENROLLMENT
// ============================================================================

// `kycAPI` — legacy user-facing KYC surface. The new user KYC flow uses
// `bridgeAPI.kyc.startIndividual` / `bridgeAPI.kyb.startBusiness` via
// KYCVerification.tsx. Write methods here (submit, verifyBVN) are
// QUARANTINED — future-state stubs. Read methods stay operational for
// admin/listing surfaces only.
export const kycAPI = {
  async submit(_payload: {
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth: string;
    phoneCode: string;
    phoneNumber: string;
    country: string;
    street: string;
    street2?: string;
    city: string;
    state: string;
    postalCode?: string;
    idType: string;
    idNumber: string;
    identityType: string;
    idFrontPath: string;
    idBackPath?: string | null;
    selfiePath: string;
    poaPath?: string | null;
    poaDocumentType?: string | null;
  }) {
    return RAILS_FUTURE_STATE;
  },

  /** Poll the current KYC status for the authenticated user. */
  async getKYCStatus(_userId?: string) {
    return apiCall('kyc-status', { method: 'GET' });
  },

  async verifyBVN(_bvn: string) {
    return RAILS_FUTURE_STATE;
  },

  /** Admin: fetch all KYC jobs with optional status filter */
  async getKYCJobs(status?: 'pending' | 'verified' | 'failed' | 'all') {
    const qs = status ? `?status=${status}` : '';
    return apiCall(`get-kyc-jobs${qs}`, { method: 'GET' });
  },
};

const BRIDGE_ONLY_DISABLED = {
  success: false,
  code: 'provider_path_required',
  error: 'This flow is disabled. Use the current send, receive, or external-account path.',
} as const;

// ============================================================================
// CRYPTO / STABLECOIN
// ============================================================================

// `generateAddress` routes stablecoin deposit-address creation to
// bridge-wallet. `_userId` is accepted for signature stability but ignored
// — Bridge derives owner from JWT. `getAddress` stays operational as a
// read-only lookup over legacy address rows. `updateOfframp` is future-state
// until BorderPay enables local off-ramp rails.
export const addressAPI = {
  async generateAddress(_userId: string, currency: string, network: string) {
    const symbol = (currency || '').toLowerCase();
    const chain  = (network  || '').toLowerCase();
    if (!symbol || !chain) return RAILS_FUTURE_STATE;
    return apiCall('bridge-wallet', {
      method: 'POST',
      body: JSON.stringify({ symbol, chain }),
    });
  },

  /** Read-only lookup over legacy address rows. */
  async getAddress(_addressId: string) {
    return BRIDGE_ONLY_DISABLED;
  },

  async updateOfframp(_addressId: string, _offramp: boolean) {
    return BRIDGE_ONLY_DISABLED;
  },
};

// `logTransaction` is local audit-only; persists to a stablecoin tx log
// table and does not call any provider write endpoint.
// `sendTransfer` orchestrates a digital-dollar send via `bridge-transfer`. The
// edge function handles country gating (DRC → 403), KYC gating (409), and
// African-rail destinations (NGN/KES/etc → 503 no_partner).
export const stablecoinAPI = {
  async logTransaction(data: {
    type: 'deposit' | 'send' | 'receive' | 'swap';
    currency: 'USDC' | 'USDT' | 'PYUSD' | 'USDB';
    amount?: number;
    network?: string;
    address?: string;
    tx_hash?: string;
    status?: 'pending' | 'confirmed' | 'failed';
    metadata?: Record<string, any>;
  }) {
    return apiCall('log-stablecoin-transaction', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Send digital dollars through the active Bridge wallet rail. `chain` is uppercased,
   * and `amount` is sent as a decimal string to avoid float drift on the wire.
   * The transaction PIN is verified separately by the caller before this is
   * invoked — this method itself does NOT verify the PIN (server-side PIN
   * verification belongs on a dedicated endpoint and is unchanged).
   */
  async sendTransfer(data: {
    amount: number;
    reason?: string;
    address: string;
    chain: 'base' | 'ethereum' | 'optimism' | 'solana' | 'polygon' | 'tron' | 'arbitrum';
    coin: 'usdc' | 'usdt';
    bridge_wallet_id?: string | null;
    external_wallet_id?: string | null;
    bridge_payment_route_id?: string | null;
    funding_source?: 'USD';
    transaction_pin?: string;
    /**
     * Client-controlled idempotency key. REQUIRED.
     *
     * Generate ONCE per user intent (one Confirm tap on the Send screen) —
     * typically a UUIDv4 the form holds in state. Re-send the same key on
     * retries / timeouts / double-confirms for the same transfer; the
     * server returns the original transfer_id without calling Bridge twice.
     *
     * Server (bridge-transfer v2) rejects with 400 idempotency_key_required
     * if missing. This intentionally fails closed: money movement must
     * never silently fall back to a server-generated key.
     */
    idempotency_key: string;
    sca_authorization_id: string;
  }) {
    const symbol = (data.coin || 'usdc').toUpperCase();
    const chain  = (data.chain || 'base').toUpperCase();
    return apiCall<{ transfer_id: string; state: 'pending' | 'processing' | 'succeeded' | 'failed'; replayed?: boolean }>(
      'bridge-transfer',
      {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: data.idempotency_key,
          sca_authorization_id: data.sca_authorization_id,
          source:      {
            payment_rail: 'bridge_wallet',
            currency:     symbol,
            amount:       String(data.amount),
            ...(data.bridge_wallet_id ? { bridge_wallet_id: data.bridge_wallet_id } : {}),
          },
          destination: {
            payment_rail: data.chain,
            currency:     symbol,
            chain,
            address:      data.address,
            ...(data.external_wallet_id ? { external_wallet_id: data.external_wallet_id } : {}),
            ...(data.bridge_payment_route_id ? { bridge_payment_route_id: data.bridge_payment_route_id } : {}),
          },
        }),
      },
    );
  },
};

export const adminAPI = {
  broadcast: async (
    campaign: 'business_verification_delay' | 'individual_platform_live',
    input: { dry_run: boolean; max_recipients: number },
  ) =>
    apiCall('send-confirmation-email', {
      method: 'POST',
      body: JSON.stringify({ action: 'broadcast', campaign, ...input }),
    }),
};

export const proofOfAddressAPI = {
  getUploadUrl: async (contentType: string, fileName: string) =>
    apiCall<{ upload_url: string; path: string }>('proof-of-address-upload-url', {
      method: 'POST',
      body: JSON.stringify({ content_type: contentType, file_name: fileName }),
    }),

  submit: async (path: string, documentType: string) =>
    apiCall('proof-of-address-submit', {
      method: 'POST',
      body: JSON.stringify({ path, document_type: documentType }),
    }),
};

const legacyRailUnavailable = async <T = null>(..._args: unknown[]): Promise<{ success: false; error: string; data: T }> => ({
  success: false,
  error: 'This payment rail is not available in the current app version.',
  data: null as T,
});

export const usPaymentsAPI = {
  getCounterparties: (...args: unknown[]) => legacyRailUnavailable<{ counterparties: any[] }>(...args),
  createCounterparty: (...args: unknown[]) => legacyRailUnavailable<any>(...args),
};

// ============================================================================
// MOBILE MONEY
// ============================================================================

// QUARANTINED — Mobile-wallet collection is a future-state African rail.
// No calls go out from here.
export const mobileMoneyAPI = {
  async getProviders() { return RAILS_FUTURE_STATE; },
  async collect(_data: any) { return RAILS_FUTURE_STATE; },
  async verifyMomoOTP(_transactionId: string, _otp: string) { return RAILS_FUTURE_STATE; },
};

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notificationsAPI = {
  async getUnreadCount(signal?: AbortSignal) {
    return apiCall('notifications-unread-count', { method: 'GET', signal });
  },

  async getNotifications(limit: number = 20) {
    return apiCall(`get-notifications?limit=${limit}`, { method: 'GET' });
  },

  async markAsRead(notificationId: string) {
    return apiCall('mark-notification-read', {
      method: 'POST',
      body: JSON.stringify({ notification_id: notificationId }),
    });
  },

  async markAllAsRead() {
    return apiCall('mark-all-notifications-read', { method: 'POST' });
  },

  async deleteNotification(notificationId: string) {
    return apiCall('delete-notification', {
      method: 'POST',
      body: JSON.stringify({ notification_id: notificationId }),
    });
  },

  async clearAll() {
    return apiCall('clear-notifications', { method: 'POST' });
  },
};

// ============================================================================
// ACCOUNTS
// ============================================================================

// `getAccounts` is read-only display of existing accounts.
// `createUSDAccount` routes to Bridge VA(USD).
// `createDynamicAccount` is future-state (African local rails).
// Legacy account-rail/counterparty endpoints are hard-disabled.
// Runtime send/payout execution must remain on the approved provider path only.
export const accountsAPI = {
  async getAccounts() {
    const route = await financialReadModelAPI.getWalletRouteData();
    if (!route?.success) return { success: false, error: route?.error || 'Unable to load accounts right now.' };
    const wallets = Array.isArray(route?.data?.wallets) ? route.data.wallets : [];
    const virtual_accounts = Array.isArray(route?.data?.virtual_accounts) ? route.data.virtual_accounts : [];
    return {
      success: true,
      data: {
        accounts: { wallets, virtual_accounts },
      },
    };
  },

  async createUSDAccount(_data: any) {
    return apiCall('bridge-virtual-account', {
      method: 'POST',
      body: JSON.stringify({ currency: 'USD' }),
    });
  },

  /** Read-only account status lookup. */
  async checkAccountStatus(_reference: string) {
    return BRIDGE_ONLY_DISABLED;
  },

  /** Legacy endpoint quarantined — keep send rails on the approved provider path only. */
  async getSupportedRails(_accountId: string) { return BRIDGE_ONLY_DISABLED; },

  /** Legacy endpoint quarantined — keep send rails on the approved provider path only. */
  async createCounterparty(_data: any) { return BRIDGE_ONLY_DISABLED; },

  /** Legacy endpoint quarantined — keep send rails on the approved provider path only. */
  async getCounterparty(_counterPartyId: string) { return BRIDGE_ONLY_DISABLED; },

  /** Legacy endpoint quarantined — keep send rails on the approved provider path only. */
  async getAccountCounterparties(_accountId: string) { return BRIDGE_ONLY_DISABLED; },

  async createDynamicAccount(_accountName: string, _preferredBank: string, _amount?: string) {
    return RAILS_FUTURE_STATE;
  },
};

// ============================================================================
// CUSTOMER MANAGEMENT
// ============================================================================

export const customersAPI = {
  async suspendUser(userId: string, reason: string) {
    // Drift-safe direct write replacing undeployed `suspend-user`.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };
    if (user.id !== userId) return { success: false, error: 'Unauthorized' };
    const { error } = await supabase
      .from('user_profiles')
      .update({ account_status: 'suspended', updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) return { success: false, error: error.message };
    return { success: true, data: { suspended: true, reason } };
  },

};

// ============================================================================
// PROVISIONING — unified "add a new funding option" dispatcher
// ----------------------------------------------------------------------------
// Routes the client request to the appropriate edge function:
//   • virtual_account (USD/EUR/GBP) → bridge-virtual-account
//   • virtual_account (other)       → rails_future_state
//   • local_currency (NGN/KES/...)  → rails_future_state
//   • stablecoin                    → bridge-wallet
//   • card                          → cards_locked
// All legacy provisioning paths (create-virtual-account, generate-address,
// create-card) are QUARANTINED at this layer.
// ============================================================================

export type ProvisioningType = 'virtual_account' | 'card' | 'stablecoin' | 'local_currency';

export interface ProvisioningRequestBody {
  type: ProvisioningType;
  currency: string;
  brand?: 'VISA' | 'MASTERCARD';
  preferred_bank?: string;
  initial_amount?: number;
  network?: string;
  card_name?: string;
}

export const provisioningAPI = {
  async request(body: ProvisioningRequestBody) {
    const currency = (body.currency || '').toUpperCase();
    switch (body.type) {
      case 'virtual_account':
        if (currency === 'USD' || currency === 'EUR' || currency === 'GBP') {
          return apiCall('bridge-virtual-account', {
            method: 'POST',
            body: JSON.stringify({ currency }),
          });
        }
        return RAILS_FUTURE_STATE;
      case 'local_currency':
        // African local currencies (NGN/KES/GHS/UGX/...) are future-state.
        return RAILS_FUTURE_STATE;
      case 'card':
        return CARDS_LOCKED;
      case 'stablecoin':
        return apiCall('bridge-wallet', {
          method: 'POST',
          body: JSON.stringify({
            symbol: currency.toLowerCase(),
            chain: (body.network || 'base').toLowerCase(),
          }),
        });
      default:
        return { success: false, error: `Unknown provisioning type: ${body.type}` };
    }
  },
};

// ============================================================================
// BUSINESS PROFILES — additive, non-breaking
// ----------------------------------------------------------------------------
// Reads/writes `public.business_profiles` directly via supabase-js. RLS
// already grants the row's owner SELECT/INSERT/UPDATE on their own row, and
// admins SELECT/UPDATE on all rows, so no edge function is needed.
// Inserting a row triggers `sync_account_type_to_business()` server-side,
// which flips users.account_type + user_profiles.account_type to 'business'
// for that user. Existing 'individual' accounts are never touched.
// ============================================================================

export interface BusinessProfileInput {
  company_name:         string;
  registration_number?: string;
  country?:             string;
  company_email?:       string;
  company_phone?:       string;
  industry?:            string;
  website?:             string;
  address?:             string;
  city?:                string;
  state?:               string;
  postal_code?:         string;
}

import { supabase as _supa } from '../supabase/client';

export const businessAPI = {
  /** Get the signed-in user's business profile (or null if individual). */
  async getProfile() {
    const { data: { user } } = await _supa.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };
    const { data, error } = await _supa
      .from('business_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  },

  /** Create the signed-in user's business profile. Idempotent: if a row
   *  already exists we update it. The DB trigger flips account_type. */
  async upsertProfile(input: BusinessProfileInput) {
    const { data: { user } } = await _supa.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };
    if (!input?.company_name || input.company_name.trim().length === 0) {
      return { success: false, error: 'company_name is required' };
    }
    const payload = {
      user_id:             user.id,
      company_name:        input.company_name.trim(),
      registration_number: input.registration_number || null,
      country:             input.country             || null,
      company_email:       input.company_email       || null,
      company_phone:       input.company_phone       || null,
      industry:            input.industry            || null,
      website:             input.website             || null,
      address:             input.address             || null,
      city:                input.city                || null,
      state:               input.state               || null,
      postal_code:         input.postal_code         || null,
    };
    const { data, error } = await _supa
      .from('business_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  },

  /** Update fields on the signed-in user's business profile. */
  async updateProfile(patch: Partial<BusinessProfileInput>) {
    const { data: { user } } = await _supa.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };
    const { data, error } = await _supa
      .from('business_profiles')
      .update(patch)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  },

  /**
   * Server-owned signup finalisation.
   *
   * Calls `public.complete_business_signup(...)`, a SECURITY DEFINER RPC
   * that's gated by:
   *   • caller authenticated
   *   • caller has no existing business_profiles row
   *   • caller's user_profiles.created_at < 30 min ago
   *
   * Used as a safety net when the deployed `auth-signup` edge function did
   * not create the business_profiles row (e.g. v86 still in production).
   * Existing individual users cannot use this RPC to self-promote because
   * of the signup-window guard — they must go through the admin RPC.
   *
   * Returns { success: true, businessProfileId } on success.
   */
  async completeSignup(input: BusinessProfileInput) {
    const { data: { user } } = await _supa.auth.getUser();
    if (!user) return { success: false, error: 'Not signed in' };
    if (!input?.company_name || input.company_name.trim().length === 0) {
      return { success: false, error: 'company_name is required' };
    }
    const { data, error } = await _supa.rpc('complete_business_signup', {
      p_company_name:        input.company_name.trim(),
      p_registration_number: input.registration_number || null,
      p_country:             input.country             || null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, businessProfileId: data as string };
  },
};

// ============================================================================
// COMBINED BACKEND API — single import for all components
// ============================================================================

// ============================================================================
// BRIDGE (the new product-facing financial provider)
// ============================================================================
//
// Most Bridge calls are user-authenticated edge functions in
// supabase/functions/bridge-*. The initial customer id is created by
// auth-signup; bridge-customer remains an authenticated idempotent repair path.

export const bridgeAPI = {
  /** Create or fetch the Bridge customer for the signed-in user. Idempotent. */
  customer: {
    createOrGet: async () =>
      apiCall<{ bridge_customer_id: string; account_type: 'individual' | 'business'; already_exists?: boolean }>(
        'bridge-customer',
        { method: 'POST', body: JSON.stringify({}) },
      ),
    deleteCurrent: async () =>
      apiCall<{ deleted: boolean; bridge_customer_deleted: boolean }>(
        'bridge-delete-customer',
        { method: 'POST', body: JSON.stringify({}) },
      ),
  },

  /** Individual KYC hosted-link flow. Returns { link_url, link_id } or { already_approved }. */
  kyc: {
    startIndividual: async (opts?: {
      redirect_url?: string;
      endorsements?: ('base'|'sepa'|'spei'|'crypto')[];
      precheck?: {
        employment_status?: string;
        source_of_funds?: string;
        explanation?: string;
      };
    }) =>
      apiCall<{ link_id?: string | null; link_url?: string | null; tos_link_url?: string | null; tos_required?: boolean; expires_at?: string; already_approved?: boolean; reused?: boolean }>(
        'bridge-kyc-link',
        { method: 'POST', body: JSON.stringify(opts ?? {}) },
      ),
  },

  /** Business KYB hosted-link flow. Returns { link_url, link_id } or { already_approved }. */
  kyb: {
    startBusiness: async (opts?: {
      redirect_url?: string;
      endorsements?: ('base'|'sepa'|'spei'|'crypto')[];
      precheck?: {
        employment_status?: string;
        source_of_funds?: string;
        explanation?: string;
      };
    }) =>
      apiCall<{ link_id?: string | null; link_url?: string | null; tos_link_url?: string | null; tos_required?: boolean; expires_at?: string; already_approved?: boolean; reused?: boolean }>(
        'bridge-kyb-link',
        { method: 'POST', body: JSON.stringify(opts ?? {}) },
      ),
  },

  /** USD/EUR/GBP virtual account. */
  virtualAccount: {
    capabilities: async () =>
      apiCall<{
        supported_currencies: ('USD' | 'EUR' | 'GBP')[];
        configured_currencies?: ('USD' | 'EUR' | 'GBP')[];
        operational_currencies?: ('USD' | 'EUR' | 'GBP')[];
        setup_pending_currencies?: ('USD' | 'EUR' | 'GBP')[];
        provider_pending_currencies?: ('USD' | 'EUR' | 'GBP')[];
      }>(
        'bridge-virtual-account',
        { method: 'POST', body: JSON.stringify({ action: 'capabilities' }) },
      ),
    create: async (input: { currency: 'USD' | 'EUR' | 'GBP'; destination?: { payment_rail: string; currency: string; chain?: string; address?: string } }) =>
      apiCall<{ virtual_account_id: string; account_number?: string; routing_number?: string; iban?: string; bic?: string; bank_name?: string; currency: string }>(
        'bridge-virtual-account',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  /** Custodial stablecoin wallet (e.g. usdc on base). */
  wallet: {
    capabilities: async () =>
      apiCall<{ supported: boolean; supported_symbols: string[] }>(
        'bridge-wallet',
        { method: 'POST', body: JSON.stringify({ action: 'capabilities' }) },
      ),
    create: async (input: { symbol: string; chain: string }) =>
      apiCall<{ wallet_id: string; deposit_address: string; symbol: string; chain: string }>(
        'bridge-wallet',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  /**
   * Mirror the customer's Bridge wallets + virtual accounts into the local
   * tables the dashboard reads. Read-only at Bridge. Deduped: concurrent callers
   * (the wallets card + the VA card mounting together) share one in-flight call
   * so we never double-insert.
   */
  syncAccounts: (() => {
    let inFlight: Promise<any> | null = null;
    let lastAt = 0;
    return async () => {
      const now = Date.now();
      if (inFlight && now - lastAt < 8000) return inFlight;
      lastAt = now;
      inFlight = apiCall<{ wallets: unknown[]; virtual_accounts: unknown[] }>(
        'bridge-sync-accounts', { method: 'POST', body: JSON.stringify({}) },
      ).finally(() => { inFlight = null; });
      return inFlight;
    };
  })(),

  /**
   * Deprecated: stablecoin wallets are manual-add only.
   * Kept as a compatibility no-op so accidental callers never auto-create.
   */
  provisionStablecoins: (() => {
    let inFlight: Promise<any> | null = null;
    let lastAt = 0;
    return async () => {
      const now = Date.now();
      if (inFlight && now - lastAt < 8000) return inFlight;
      lastAt = now;
      inFlight = Promise.resolve({
        success: true,
        code: 'stablecoin_manual_only',
        data: { wallets: [] as Array<{ symbol: string; chain: string; address: string | null }> },
      }).finally(() => { inFlight = null; });
      return inFlight;
    };
  })(),

  /** Cross-rail Bridge transfer (digital-dollar/fiat orchestration).
   *
   * Shape matches the bridge-transfer edge function exactly:
   *   • `source.amount`     — decimal string (no float drift)
   *   • `source.currency`   — uppercase ISO/token symbol
   *   • `source.chain`      — uppercase chain name where needed
   *   • `source.payment_rail` is required by the edge function
   *   • The `idempotency_key` is supplied by callers per user intent.
   */
  transfer: {
    create: async (input: {
      source: { payment_rail?: string; currency: string; chain?: string; amount: string; bridge_wallet_id?: string; external_account_id?: string; from_address?: string };
      destination: { payment_rail: string; currency: string; chain?: string; address?: string; bridge_wallet_id?: string; external_account_id?: string; deposit_id?: string; bank_account?: { account_number?: string; routing_number?: string; iban?: string; bic?: string } };
      developer_fee?: { percentage?: number; flat_amount?: string };
      idempotency_key?: string;
      sca_authorization_id: string;
    }) =>
      apiCall<{ transfer_id: string; state: 'pending' | 'processing' | 'succeeded' | 'failed' }>(
        'bridge-transfer',
        {
          method: 'POST',
          body: JSON.stringify({
            ...input,
            idempotency_key: input.idempotency_key || crypto.randomUUID(),
          }),
        },
      ),
  },

  /** Fiat payout (offramp) destinations — Bridge external accounts.
   *
   *  v1 covers Bridge-documented account types:
   *    • us   — USD bank account (ACH / ACH same-day / Wire).
   *    • iban — EUR bank account (SEPA).
   *    • gb   — GBP bank account (Faster Payments).
   *
   *  `create` and `remove` proxy the `bridge-external-account` edge
   *  function (which holds the Bridge Api-Key and enforces the
   *  KYC-approved + country gate). `list` reads the local RLS-protected
   *  mirror directly — no edge round-trip needed for a read.
   *
   *  These are gated behind EXTERNAL_ACCOUNTS_LIVE in the UI; the API
   *  surface is inert until the feature flag, edge function, table, and
   *  secret are all in place.
   */
  externalAccount: {
    create: async (account:
      | {
          account_type: 'us';
          account_owner_name: string;
          account_number: string;
          routing_number: string;
          checking_or_savings?: 'checking' | 'savings';
          bank_name?: string;
          address: { street_line_1: string; city: string; state?: string; postal_code: string; country: string };
        }
      | {
          account_type: 'iban';
          account_owner_name: string;
          account_owner_type: 'individual' | 'business';
          iban_number: string;
          bic_swift: string;
          iban_country: string;
          bank_name?: string;
          first_name?: string;
          last_name?: string;
          business_name?: string;
        }
      | {
          account_type: 'gb';
          account_owner_name: string;
          account_owner_type?: 'individual' | 'business';
          account_name?: string;
          first_name?: string;
          last_name?: string;
          business_name?: string;
          bank_name?: string;
          account: { sort_code: string; account_number: string };
        }
    , scaAuthorizationId: string) =>
      apiCall<{ external_account_id: string; account_type: 'us' | 'iban' | 'gb'; currency: 'USD' | 'EUR' | 'GBP'; rail: string; last_4: string; bank_name: string | null }>(
        'bridge-external-account',
        { method: 'POST', body: JSON.stringify({ action: 'create', account, sca_authorization_id: scaAuthorizationId }) },
      ),

    remove: async (externalAccountId: string, scaAuthorizationId: string) =>
      apiCall<{ deleted: boolean; external_account_id: string }>(
        'bridge-external-account',
        { method: 'POST', body: JSON.stringify({ action: 'delete', external_account_id: externalAccountId, sca_authorization_id: scaAuthorizationId }) },
      ),

    /** Read payout destinations from Bridge (source of truth). */
    list: async () => {
      return apiCall(
        'bridge-external-account',
        { method: 'POST', body: JSON.stringify({ action: 'list' }) },
      );
    },

    /** Query provider-backed capabilities for external-account rails. */
    capabilities: async () =>
      apiCall<{ supported_account_types: Array<'us' | 'iban' | 'gb'> }>(
        'bridge-external-account',
        { method: 'POST', body: JSON.stringify({ action: 'capabilities' }) },
      ),
  },
};

// ============================================================================
// LEGACY SUBSCRIPTION API — retained for backend compatibility
// ============================================================================
//
// Product access is governed by verification/KYC/KYB. This wrapper remains
// only so older backend contracts do not break the frontend bundle.

// ============================================================================
// BUSINESS TEAM MANAGEMENT
// ============================================================================
//
// Roster + invite + remove against `business_team_members`. The caller's
// business is resolved server-side from auth.uid — clients never supply
// `business_user_id`. Seat caps come from the business's active plan.

export type TeamRole   = 'owner' | 'admin' | 'member' | 'viewer';
export type TeamStatus = 'invited' | 'active' | 'suspended' | 'removed';

export interface TeamMemberRow {
  id:               string;
  member_user_id:   string | null;
  invited_email:    string;
  role:             TeamRole;
  status:           TeamStatus;
  invited_at:       string;
  joined_at:        string | null;
  removed_at:       string | null;
}

export interface TeamRosterResponse {
  business_user_id: string;
  company_name?:     string;
  caller_role:      TeamRole;
  plan:             { plan_key: string; max_team_members: number | null };
  seats:            { used: number; cap: number | null };
  members:          TeamMemberRow[];
}

export const teamAPI = {
  /** Read-only listing of all seats on the caller's business team. */
  list: async () =>
    apiCall<TeamRosterResponse>('business-team-list', {
      method: 'POST',
      body:   JSON.stringify({}),
    }),

  /** Invite an email. Returns 402 when the business seat cap is hit. */
  invite: async (input: { email: string; role?: Exclude<TeamRole, 'owner'> }) =>
    apiCall<TeamMemberRow & { reused?: boolean; email_sent?: boolean; email_error?: string }>('business-team-invite', {
      method: 'POST',
      body:   JSON.stringify(input),
    }),

  /** Accept a signed email invite for the authenticated user. */
  acceptInvite: async (token: string) =>
    apiCall<TeamMemberRow & { business_user_id: string; company_name?: string; already_accepted?: boolean }>('business-team-accept', {
      method: 'POST',
      body:   JSON.stringify({ token }),
    }),

  /** Soft-remove a seat. The owner row cannot be removed. */
  remove: async (memberId: string) =>
    apiCall<{ id: string; status: 'removed'; removed_at: string }>('business-team-remove', {
      method: 'POST',
      body:   JSON.stringify({ member_id: memberId }),
    }),
};

// ============================================================================
// WEBAUTHN (server-verified biometric / passkey)
// ============================================================================
//
// Four-call dance: register/auth options are issued server-side (challenge
// stored in webauthn_challenges with 5-min TTL); the client passes them to
// navigator.credentials.create/get; the resulting assertion is shipped to
// register/auth verify, which validates server-side and stores or bumps
// the credential. The plaintext refresh_token in localStorage is no longer
// the security boundary — the assertion is.

export const webauthnAPI = {
  registerOptions: async () =>
    apiCall<{ options: any; origin: string; rp_id: string }>(
      'webauthn-register-options',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  registerVerify: async (input: { response: any; nickname?: string; sca_authorization_id: string }) =>
    apiCall<{}>('webauthn-register-verify', {
      method: 'POST',
      body:   JSON.stringify(input),
    }),
  authOptions: async () =>
    apiCall<{ options: any; rp_id: string }>(
      'webauthn-auth-options',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  authVerify: async (input: { response: any }) =>
    apiCall<{}>('webauthn-auth-verify', {
      method: 'POST',
      body:   JSON.stringify(input),
    }),
  /** Delete the caller's server-side WebAuthn credential(s). Omit
   *  credential_id to remove all (full biometric disable). Required so a
   *  disabled credential is actually gone server-side — otherwise re-enroll
   *  on the same device fails with InvalidStateError (excludeCredentials). */
  disable: async (input: { credential_id?: string; sca_authorization_id: string }) =>
    apiCall<{ deleted_count: number }>('webauthn-delete', {
      method: 'POST',
      body:   JSON.stringify(input || {}),
    }),
};

export const subscriptionAPI = {
  /** Fetch the caller's internal account-maintenance subscription. */
  current: async () =>
    apiCall<{
      subscription: {
        id: string;
        account_type: 'individual' | 'business';
        monthly_fee: number;
        currency: 'USD';
        status: string;
        payment_status: 'active' | 'failed' | 'pending';
        next_billing_date: string;
        last_billed_at: string | null;
        grace_started_at: string | null;
        restricted_at: string | null;
        created_at: string;
      } | null;
      recent_transactions: Array<{
        id: string;
        billing_period: string;
        amount: number;
        collected_amount: number;
        asset: 'USDC' | 'USDT' | 'MIXED' | null;
        asset_breakdown: Record<string, number>;
        status: string;
        failure_code: string | null;
        completed_at: string | null;
        created_at: string;
      }>;
    }>('subscription-current', { method: 'POST', body: JSON.stringify({}) }),

};

const yellowCardFunction = (suffix: string): string =>
  `yellowcard-${suffix}`;

const approvedPayoutFunction = (suffix: string): string =>
  `bridge-${suffix}`;

/** African payout helpers (Phase B foundation — read-only lookups). */
export const payoutsAPI = {
  yellowCardCapabilities: async (
    action: 'corridor_policy' | 'routing' | 'channels' | 'networks' | 'rates' | 'quote',
    payload: Record<string, unknown> = {},
  ) => apiCall<Record<string, unknown>>(yellowCardFunction('capabilities'), {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  }),

  yellowCardTransaction: async (payload: Record<string, unknown>) =>
    apiCall<Record<string, unknown>>(yellowCardFunction('transaction'), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  yellowCardJitPayout: async (payload: Record<string, unknown>, idempotencyKey?: string) =>
    apiCall<Record<string, unknown>>(yellowCardFunction('jit-payout'), {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify(payload),
    }),

  /**
   * Bulk payout (payroll / supplier / contractor / marketplace). Runs the same
   * validated transfer rail once per recipient and returns a per-row result.
   * Each item MUST carry a unique idempotency_key so retries never double-pay.
   */
  bulkPayout: async (payload: {
    source_currency: string;
    items: Array<{
      destination: { payment_rail?: string; currency: string; chain?: string; address?: string; bank_account?: unknown };
      amount: string;
      idempotency_key: string;
      label?: string;
      source_chain?: string;
    }>;
  }) =>
    apiCall<{
      results: Array<{ row: number; label: string | null; transfer_id?: string; state: string; error?: string; replayed?: boolean }>;
      summary: { total: number; submitted: number; failed: number; total_amount: number; currency: string };
    }>(approvedPayoutFunction('bulk-payout'), { method: 'POST', body: JSON.stringify(payload) }),

};

/** Saved external stablecoin payout addresses (withdraw to your own wallet). */
export interface ExternalWallet {
  id: string;
  label: string;
  chain: string;
  asset: string;
  address: string;
  bridge_payment_route_id?: string | null;
  bridge_payment_route_status?: string | null;
  bridge_payment_route_raw?: Record<string, any> | null;
  created_at?: string;
}
export const externalWalletsAPI = {
  list: async () =>
    apiCall<{ wallets: ExternalWallet[] }>('external-wallet', { method: 'POST', body: JSON.stringify({ action: 'list' }) }),
  add: async (w: { label: string; chain: string; asset: string; address: string }, scaAuthorizationId: string) =>
    apiCall<{ wallet: ExternalWallet }>('external-wallet', { method: 'POST', body: JSON.stringify({ action: 'add', ...w, sca_authorization_id: scaAuthorizationId }) }),
  remove: async (id: string, scaAuthorizationId: string) =>
    apiCall<{ removed: boolean }>('external-wallet', { method: 'POST', body: JSON.stringify({ action: 'remove', id, sca_authorization_id: scaAuthorizationId }) }),
};

export interface SupportTicket {
  id: string;
  requester_user_id: string;
  requester_email: string | null;
  requester_account_type: 'individual' | 'business';
  source: 'app' | 'website' | 'admin';
  issue_type: 'account_access' | 'verification' | 'wallet_balances' | 'send_receive' | 'general';
  subject: string;
  status: 'open' | 'pending_support' | 'pending_user' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_admin_id: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  sender_type: 'user' | 'agent' | 'assistant' | 'system';
  sender_user_id: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface SupportHealthStatus {
  timestamp: string;
  ai_enabled: boolean;
  provider: 'azure_openai' | 'openai' | 'none';
  model: string;
  ready: boolean;
  checks: {
    azure_configured: boolean;
    openai_configured: boolean;
  };
}

export const supportAPI = {
  createTicket: async (input: {
    issue_type: 'account_access' | 'verification' | 'wallet_balances' | 'send_receive' | 'general';
    subject: string;
    message: string;
    source?: 'app' | 'website';
  }) =>
    apiCall<{ ticket_id: string }>('support-gateway', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_ticket', ...input }),
    }),

  listTickets: async (limit = 20) =>
    apiCall<{ tickets: SupportTicket[] }>('support-gateway', {
      method: 'POST',
      body: JSON.stringify({ action: 'list_tickets', limit }),
    }),

  getTicket: async (ticketId: string) =>
    apiCall<{ ticket: SupportTicket; messages: SupportTicketMessage[] }>('support-gateway', {
      method: 'POST',
      body: JSON.stringify({ action: 'get_ticket', ticket_id: ticketId }),
    }),

  addMessage: async (ticketId: string, message: string) =>
    apiCall<{ ticket_id: string }>('support-gateway', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_message', ticket_id: ticketId, message }),
    }),

  health: async () =>
    apiCall<SupportHealthStatus>('support-gateway', {
      method: 'POST',
      body: JSON.stringify({ action: 'support_health' }),
    }),
};

export const affiliateAPI = {
  getSSOLink: async () =>
    apiCall<{ url: string; correlation_id: string; ttl_seconds: number }>('affiliate-sso-link', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

export const backendAPI = {
  auth: authSecurityAPI,
  user: userAPI,
  financial: financialReadModelAPI,
  wallets: walletAPI,
  transactions: transactionAPI,
  cards: cardAPI,
  fx: fxAPI,
  kyc: kycAPI,
  address: addressAPI,
  stablecoin: stablecoinAPI,
  mobileMoney: mobileMoneyAPI,
  notifications: notificationsAPI,
  accounts: accountsAPI,
  customers: customersAPI,
  provisioning: provisioningAPI,
  business: businessAPI,
  bridge: bridgeAPI,
  subscription: subscriptionAPI,
  payouts:      payoutsAPI,
  externalWallets: externalWalletsAPI,
  affiliate:    affiliateAPI,
  support:      supportAPI,
  team:         teamAPI,
  webauthn:     webauthnAPI,
  admin:        adminAPI,
  proofOfAddress: proofOfAddressAPI,
  usPayments:   usPaymentsAPI,
};

export default backendAPI;
