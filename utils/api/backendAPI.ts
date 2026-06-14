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

// ── CSRF token (per-session, rotated on page load) ───────────────────────────
const CSRF_TOKEN = crypto.randomUUID();

// ── Sanitize error messages to prevent info leakage ──────────────────────────
function sanitizeError(raw: string | undefined): string {
  if (!raw) return 'Something went wrong. Please try again.';
  // Strip anything that looks like a key, URL, or internal path
  if (/supabase|secret|key|token|password|internal/i.test(raw)) {
    return 'Something went wrong. Please try again.';
  }
  return raw;
}

// ── Core API caller with retry for transient network failures ────────────────

async function apiCall<T = any>(
  endpoint: string,
  options: RequestInit = {},
  retries: number = 0
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const token = authAPI.getToken();

    // When body is FormData, let the browser set Content-Type (multipart boundary)
    const isFormData = options.body instanceof FormData;
    const baseHeaders: Record<string, string> = {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${token || ANON_KEY}`,
      'X-CSRF-Token': CSRF_TOKEN,
    };
    if (!isFormData) {
      baseHeaders['Content-Type'] = 'application/json';
    }
    const headers: HeadersInit = {
      ...baseHeaders,
      ...options.headers,
    } as Record<string, string>;

    const response = await fetch(`${BASE_URL}/${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    // Wallet-debit paywall: when an edge function returns 402 with
    // `code: 'plan_required'`, surface it as a DOM event so any screen can
    // pop the UpgradeModal without having to thread the response code through
    // every caller. MainApp listens for this event and opens the modal.
    if (response.status === 402 && data?.code === 'plan_required' && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('borderpay:plan_required', { detail: data }));
      } catch { /* SSR / no CustomEvent — ignore */ }
    }

    if (!response.ok) {
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
      return data;
    }

    return { success: true, data };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return { success: false, error: 'Request aborted' };
    }
    // Retry once on network failure for critical calls
    if (retries < 1 && !options.signal?.aborted) {
      return apiCall<T>(endpoint, options, retries + 1);
    }
    return {
      success: false,
      error: 'Unable to connect to our servers. Please check your internet connection and try again.',
    };
  }
}

async function apiCallPublic<T = any>(
  endpoint: string,
  options: RequestInit = {},
  anonKey?: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const key = anonKey || ANON_KEY;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      ...options.headers,
    };

    const response = await fetch(`${BASE_URL}/${endpoint}`, { ...options, headers });
    const data = await response.json();
    if (!response.ok) {
      // Preserve structured server codes (cooldown / rate_limit / expired /
      // already_used / not_found / purpose_mismatch / malformed) on public
      // endpoints so the auth screens can render specific UX. Mirrors the
      // behaviour of the authenticated apiCall path.
      return {
        success: false,
        error: data.error || data.message || `Request failed: ${response.status}`,
        ...(data?.code      ? { code:      data.code      } : {}),
        ...(data?.upgrade_to ? { upgrade_to: data.upgrade_to } : {}),
      } as any;
    }

    if (data && typeof data === 'object' && 'success' in data) {
      return data;
    }
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to connect to our servers.' };
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

  async signup(data: {
    email:        string;
    password:     string;
    full_name:    string;
    phone_number: string;
    country_code: string;
    /**
     * Optional. Default 'individual' on the server. When 'business', the
     * client also collects `company_name` (+ optional `registration_number`)
     * and inserts a public.business_profiles row post-confirmation. The
     * value is recorded in auth.users.raw_user_meta_data for audit.
     */
    account_type?:        'individual' | 'business';
    company_name?:        string;
    registration_number?: string;
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

  async changePIN(oldPin: string, newPin: string) {
    return apiCall('change-pin', {
      method: 'POST',
      body: JSON.stringify({ old_pin: oldPin, new_pin: newPin }),
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

  async disable2FA(userId: string, password: string) {
    return apiCall('disable-2fa', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, password }),
    });
  },

  async getSecurityStatus(userId: string) {
    return apiCall('get-security-status', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async updateSecurityStatus(updates: { pin_set?: boolean; two_factor_enabled?: boolean }) {
    return apiCall('update-security-status', {
      method: 'POST',
      body: JSON.stringify(updates),
    });
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
};

// ============================================================================
// USER / PROFILE
// ============================================================================

export const userAPI = {
  async getProfile() {
    return apiCall('get-user-profile', { method: 'GET' });
  },

  async updateProfile(data: any) {
    return apiCall('update-user-profile', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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
// Pre-Phase-2 this called the `get-wallets` edge function. That function
// was never deployed (drift class also responsible for `send-email`,
// `get-transactions`, `poa-upload-url`, etc.). Production logs showed
// repeated `POST 404 /functions/v1/get-wallets` with `deployment_id: null`,
// causing the BusinessDashboard hero to show $0.00 + a "Could not load
// wallets" toast on every mount.
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
    const { data, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data: { wallets: data || [] } };
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
  // Pre-Phase-2 this called the `get-transactions` edge function, which
  // was never deployed (same drift class as `get-wallets`, `send-email`,
  // etc.). Production logs showed repeated `POST 404 /functions/v1/
  // get-transactions` with `deployment_id: null` — TransactionsScreen
  // would render an error toast on first mount.
  //
  // `public.transactions` has RLS enabled with policy `transactions_own =
  // (auth.uid() = user_id)` covering ALL ops. Direct supabase-js SELECT
  // returns the user's own rows, ordered newest-first, with the same
  // shape the screen already consumes. Return envelope preserved
  // (`{ success, data: { transactions: TransactionRow[] } }`).
  //
  // Note: `getCustomerTransactions`, `exportTransactions`, and
  // `verifyTransaction` below STILL call undeployed edge functions.
  // Those are not on the partner onboarding critical path (no UI
  // component lands on them on first load) and are intentionally out
  // of scope for this PR. Filed as remaining drift in the audit table.
  async getTransactions(limit = 10, offset = 0) {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return { success: false, error: userErr?.message || 'Not signed in' };
    }
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data: { transactions: data || [] } };
  },

  async getCustomerTransactions(customerId: string, filters?: any) {
    return apiCall('get-customer-transactions', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, ...filters }),
    });
  },

  async exportTransactions(userId: string, format: 'csv' | 'pdf' | 'excel', filters?: any) {
    return apiCall('export-transactions', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, format, ...filters }),
    });
  },

  async verifyTransaction(transactionId: string) {
    return apiCall('verify-transaction', {
      method: 'POST',
      body: JSON.stringify({ transaction_id: transactionId }),
    });
  },
};

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
  data:  undefined as any,
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
  async createCard(_data: {
    card_type?: string;
    brand?: string;
    initial_amount?: number;
    card_name?: string;
    spending_limit?: number;
    design_id?: string;
  }) { return CARDS_LOCKED; },

  async getCards() { return CARDS_LOCKED; },

  async getCard(_cardId: string) { return CARDS_LOCKED; },

  async getCardTransactions(_cardId: string, _filters?: {
    start_date?: string;
    end_date?: string;
    page?: string;
    page_size?: string;
  }) { return CARDS_LOCKED; },

  async fundCard(_cardId: string, _amount: number) { return CARDS_LOCKED; },

  async withdrawCard(_cardId: string, _amount: number) { return CARDS_LOCKED; },

  async freezeCard(_cardId: string) { return CARDS_LOCKED; },

  async unfreezeCard(_cardId: string) { return CARDS_LOCKED; },

  async terminateCard(_cardId: string) { return CARDS_LOCKED; },

  async getCardCharges(_filters?: {
    channel?: string;
    transaction_id?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
    search?: string;
  }) { return CARDS_LOCKED; },
};

// ============================================================================
// FX / EXCHANGE
// ============================================================================

// QUARANTINED — `getQuote` and `convert` previously called the `fx` edge
// function, which has been retired. Currency convert (fiat ↔ fiat and
// fiat ↔ stablecoin) is routed through the partner's transfer endpoint
// in a future release; until then both methods short-circuit so the
// Exchange screen can render a clear "coming soon" state instead of a 404.
// `getHistory` returns whatever audit rows exist; `getLiveRates` is
// client-side indicative fallback.
export const fxAPI = {
  async getQuote(_sourceCurrency: string, _targetCurrency: string, _amount: number) {
    return RAILS_FUTURE_STATE;
  },

  async convert(_data: {
    quote_reference: string | null;
    source_wallet_id: string;
    destination_wallet_id: string;
    amount: number;
    transaction_pin: string;
  }) {
    return RAILS_FUTURE_STATE;
  },

  async getHistory() {
    return apiCall('get-fx-history', { method: 'POST' });
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

export const proofOfAddressAPI = {
  async getUploadUrl(fileType: string, fileName: string) {
    return apiCall('poa-upload-url', {
      method: 'POST',
      body: JSON.stringify({ file_type: fileType, file_name: fileName }),
    });
  },

  async submit(filePath: string, documentType: string) {
    return apiCall('poa-submit', {
      method: 'POST',
      body: JSON.stringify({ file_path: filePath, document_type: documentType }),
    });
  },
};

// ============================================================================
// LOCAL PAYMENTS (Bank transfers)
// ============================================================================

export const localPaymentsAPI = {
  async getInstitutions(currency: string, type?: string) {
    return apiCall('get-institutions', {
      method: 'POST',
      body: JSON.stringify({ currency, type }),
    });
  },

  async fetchBankDetails(routingNumber: string, countryCode: string) {
    return apiCall('fetch-bank-details', {
      method: 'POST',
      body: JSON.stringify({ routing_number: routingNumber, country_code: countryCode }),
    });
  },

  async resolveAccount(bankCode: string, accountNumber: string, currency: string) {
    return apiCall('resolve-account', {
      method: 'POST',
      body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber, currency }),
    });
  },

  // QUARANTINED — `transfer` routes to future-state
  // (future local currency / mobile-wallet / local bank rails).
  // `verifyTransfer` and `getTransfers` are read-only and kept
  // operational for history display.
  async transfer(_data: any) {
    return RAILS_FUTURE_STATE;
  },

  async verifyTransfer(transferId: string) {
    return apiCall('verify-transfer', {
      method: 'POST',
      body: JSON.stringify({ transfer_id: transferId }),
    });
  },

  async getTransfers() {
    return apiCall('get-transfers', { method: 'POST' });
  },
};

// ============================================================================
// US PAYMENTS (ACH / Wire)
// ============================================================================

// QUARANTINED — `transfer` and `createCounterparty` will switch to
// bridgeAPI.transfer.create after sandbox smoke test. Until then both
// return rails_future_state. `getCounterparties` is read-only and kept
// operational for history display.
export const usPaymentsAPI = {
  async transfer(_data: any) {
    return RAILS_FUTURE_STATE;
  },

  async getCounterparties() {
    return apiCall('get-counterparty', { method: 'POST' });
  },

  async createCounterparty(_data: any) {
    return RAILS_FUTURE_STATE;
  },
};

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
  async getAddress(addressId: string) {
    return apiCall('get-address', {
      method: 'POST',
      body: JSON.stringify({ address_id: addressId }),
    });
  },

  async updateOfframp(_addressId: string, _offramp: boolean) {
    return RAILS_FUTURE_STATE;
  },
};

// `logTransaction` is local audit-only; persists to a stablecoin tx log
// table and does not call any provider write endpoint.
// `sendTransfer` orchestrates a stablecoin send via `bridge-transfer`. The
// edge function handles country gating (DRC → 403), KYC gating (409), and
// African-rail destinations (NGN/KES/etc → 503 no_partner). 402
// plan_required is surfaced via the global paywall interceptor (see apiCall).
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
   * Send stablecoin through the active stablecoin rail. `chain` is uppercased,
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
    coin: 'usdc' | 'usdt' | 'pyusd' | 'usdb' | 'eurc';
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
  }) {
    const symbol = (data.coin || 'usdc').toUpperCase();
    const chain  = (data.chain || 'base').toUpperCase();
    return apiCall<{ transfer_id: string; state: 'pending' | 'processing' | 'succeeded' | 'failed'; replayed?: boolean }>(
      'bridge-transfer',
      {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: data.idempotency_key,
          source:      {
            payment_rail: 'stablecoin',
            currency:     symbol,
            chain,
            amount:       String(data.amount),
          },
          destination: {
            payment_rail: 'stablecoin',
            currency:     symbol,
            chain,
            address:      data.address,
          },
        }),
      },
    );
  },
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
// Counterparty methods (`createCounterparty`, `getCounterparty`,
// `getAccountCounterparties`) and rail status (`checkAccountStatus`,
// `getSupportedRails`) are transfer-adjacent and read-only respectively;
// kept operational pending the transfers cutover.
export const accountsAPI = {
  async getAccounts() {
    return apiCall('get-accounts', { method: 'GET' });
  },

  async createUSDAccount(_data: any) {
    return apiCall('bridge-virtual-account', {
      method: 'POST',
      body: JSON.stringify({ currency: 'USD' }),
    });
  },

  /** Read-only account status lookup. */
  async checkAccountStatus(reference: string) {
    return apiCall('check-account-status', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    });
  },

  /** Read-only supported rails lookup. */
  async getSupportedRails(accountId: string) {
    return apiCall('get-account-rails', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
  },

  /** Counterparty management; held for the transfers cutover. */
  async createCounterparty(data: any) {
    return apiCall('create-counterparty', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** Counterparty management; held for the transfers cutover. */
  async getCounterparty(counterPartyId: string) {
    return apiCall('get-counterparty', {
      method: 'POST',
      body: JSON.stringify({ counter_party_id: counterPartyId }),
    });
  },

  /** Counterparty management; held for the transfers cutover. */
  async getAccountCounterparties(accountId: string) {
    return apiCall('get-account-counterparties', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
  },

  async createDynamicAccount(_accountName: string, _preferredBank: string, _amount?: string) {
    return RAILS_FUTURE_STATE;
  },
};

// ============================================================================
// CUSTOMER MANAGEMENT
// ============================================================================

export const customersAPI = {
  async suspendUser(userId: string, reason: string) {
    return apiCall('suspend-user', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, reason }),
    });
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
// All Bridge calls are user-authenticated edge functions in
// supabase/functions/bridge-*. Bridge customer creation is deferred to the
// explicit Start KYC/KYB action (it does NOT happen at signup).

export const bridgeAPI = {
  /** Create or fetch the Bridge customer for the signed-in user. Idempotent. */
  customer: {
    createOrGet: async () =>
      apiCall<{ bridge_customer_id: string; account_type: 'individual' | 'business'; already_exists?: boolean }>(
        'bridge-customer',
        { method: 'POST', body: JSON.stringify({}) },
      ),
  },

  /** Individual KYC hosted-link flow. Returns { link_url, link_id } or { already_approved }. */
  kyc: {
    startIndividual: async (opts?: { redirect_url?: string; endorsements?: ('base'|'sepa'|'spei'|'crypto')[] }) =>
      apiCall<{ link_id?: string; link_url?: string; expires_at?: string; already_approved?: boolean; reused?: boolean }>(
        'bridge-kyc-link',
        { method: 'POST', body: JSON.stringify(opts ?? {}) },
      ),
  },

  /** Business KYB hosted-link flow. Returns { link_url, link_id } or { already_approved }. */
  kyb: {
    startBusiness: async (opts?: { redirect_url?: string; endorsements?: ('base'|'sepa'|'spei'|'crypto')[] }) =>
      apiCall<{ link_id?: string; link_url?: string; expires_at?: string; already_approved?: boolean; reused?: boolean }>(
        'bridge-kyb-link',
        { method: 'POST', body: JSON.stringify(opts ?? {}) },
      ),
  },

  /** USD/EUR/GBP virtual account. */
  virtualAccount: {
    create: async (input: { currency: 'USD' | 'EUR' | 'GBP'; destination?: { payment_rail: string; currency: string; chain?: string; address?: string } }) =>
      apiCall<{ virtual_account_id: string; account_number?: string; routing_number?: string; iban?: string; bic?: string; bank_name?: string; currency: string }>(
        'bridge-virtual-account',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  /** Custodial stablecoin wallet (e.g. usdc on base). */
  wallet: {
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

  /** Cross-rail Bridge transfer (stablecoin/fiat orchestration).
   *
   * Shape matches the bridge-transfer edge function exactly:
   *   • `source.amount`     — decimal string (no float drift)
   *   • `source.currency`   — uppercase ISO/stablecoin symbol
   *   • `source.chain`      — uppercase chain name for stablecoin rails
   *   • `source.payment_rail` defaults to 'stablecoin' server-side if omitted
   *   • The `idempotency_key` is generated server-side from user_id + a
   *     short UUID; clients never supply one.
   */
  transfer: {
    create: async (input: {
      source: { payment_rail?: string; currency: string; chain?: string; amount: string };
      destination: { payment_rail: string; currency: string; chain?: string; address?: string; bank_account?: { account_number?: string; routing_number?: string; iban?: string; bic?: string } };
      developer_fee?: { percentage?: number; flat_amount?: string };
    }) =>
      apiCall<{ transfer_id: string; state: 'pending' | 'processing' | 'succeeded' | 'failed' }>(
        'bridge-transfer',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  /** Fiat payout (offramp) destinations — Bridge external accounts.
   *
   *  v1 covers two account types:
   *    • us   — USD bank account (ACH / ACH same-day / Wire).
   *    • iban — EUR bank account (SEPA).
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
    ) =>
      apiCall<{ external_account_id: string; account_type: 'us' | 'iban'; currency: 'USD' | 'EUR'; rail: string; last_4: string; bank_name: string | null }>(
        'bridge-external-account',
        { method: 'POST', body: JSON.stringify({ action: 'create', account }) },
      ),

    remove: async (externalAccountId: string) =>
      apiCall<{ deleted: boolean; external_account_id: string }>(
        'bridge-external-account',
        { method: 'POST', body: JSON.stringify({ action: 'delete', external_account_id: externalAccountId }) },
      ),

    /** Read the signed-in user's payout destinations from the local mirror
     *  (RLS: external_accounts_own). Read-only; no edge call. */
    list: async () => {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) return { success: false, error: userErr?.message || 'Not signed in' };
      const { data, error } = await supabase
        .from('bridge_external_accounts')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (error) return { success: false, error: error.message };
      return { success: true, data: { external_accounts: data || [] } };
    },
  },
};

// ============================================================================
// SUBSCRIPTIONS — wallet-debit billing (NOT Stripe)
// ============================================================================
//
// Users on Starter (free) can upgrade to Premium / Growth by paying from
// their USD virtual account balance. Enterprise is contact-sales.
// No third-party billing processor is involved.

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

  /** Invite an email. Returns 402 with code='plan_required' when seat cap is hit. */
  invite: async (input: { email: string; role?: Exclude<TeamRole, 'owner'> }) =>
    apiCall<TeamMemberRow & { reused?: boolean }>('business-team-invite', {
      method: 'POST',
      body:   JSON.stringify(input),
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
  registerVerify: async (input: { response: any; nickname?: string }) =>
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
  disable: async (input?: { credential_id?: string }) =>
    apiCall<{ deleted_count: number }>('webauthn-delete', {
      method: 'POST',
      body:   JSON.stringify(input || {}),
    }),
};

export const subscriptionAPI = {
  /** Fetch the caller's active subscription row + recent invoices. */
  current: async () =>
    apiCall<{
      subscription: {
        id: string;
        plan_key: string;
        status: string;
        current_period_start: string;
        current_period_end: string;
        cancel_at_period_end: boolean;
      } | null;
      recent_invoices: Array<{
        id: string;
        plan_key: string;
        amount_usd_cents: number;
        status: string;
        paid_at: string | null;
        created_at: string;
      }>;
    }>('subscription-current', { method: 'POST', body: JSON.stringify({}) }),

  /**
   * Upgrade to a paid plan by debiting a USD virtual account.
   * Server creates the invoice and charges atomically; no client-supplied
   * prices are honoured.
   */
  upgrade: async (input: { plan_key: 'individual_activated' | 'business_activated'; bridge_va_id: string }) =>
    apiCall<{
      invoice_id: string;
      subscription_id: string;
      previous_plan_key: string;
      plan_key: string;
      period_start: string;
      period_end: string;
      amount_usd_cents: number;
      new_balance_minor: number;
    }>('subscription-upgrade', { method: 'POST', body: JSON.stringify(input) }),

  /**
   * Start the one-time activation payment via the external gateway.
   * Records a pending payment and returns the params for the INLINE (embedded)
   * checkout — the app opens it in-page (no redirect away). Plan is inferred
   * from the user's account_type server-side.
   */
  startActivationCheckout: async () =>
    apiCall<{ checkout_url: string; tx_ref: string }>(
      'flutterwave-checkout', { method: 'POST', body: JSON.stringify({}) }),
};

/** Flutterwave African payout helpers (Phase B foundation — read-only lookups). */
export const payoutsAPI = {
  /** List banks for a 2-letter country code (e.g. 'NG', 'KE', 'GH', 'UG'). */
  listBanks: async (country: string) =>
    apiCall<{ banks: Array<{ code: string; name: string }> }>(
      'flutterwave-banks', { method: 'POST', body: JSON.stringify({ country }) }),

  /** Verify a bank account number → account holder name before payout. */
  resolveAccount: async (account_number: string, bank_code: string) =>
    apiCall<{ account_name: string }>(
      'flutterwave-resolve-account', { method: 'POST', body: JSON.stringify({ account_number, bank_code }) }),

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
    }>('bridge-bulk-payout', { method: 'POST', body: JSON.stringify(payload) }),
};

/** Saved external stablecoin payout addresses (withdraw to your own wallet). */
export interface ExternalWallet {
  id: string; label: string; chain: string; asset: string; address: string; created_at?: string;
}
export const externalWalletsAPI = {
  list: async () =>
    apiCall<{ wallets: ExternalWallet[] }>('external-wallet', { method: 'POST', body: JSON.stringify({ action: 'list' }) }),
  add: async (w: { label: string; chain: string; asset: string; address: string }) =>
    apiCall<{ wallet: ExternalWallet }>('external-wallet', { method: 'POST', body: JSON.stringify({ action: 'add', ...w }) }),
  remove: async (id: string) =>
    apiCall<{ removed: boolean }>('external-wallet', { method: 'POST', body: JSON.stringify({ action: 'remove', id }) }),
};

export const backendAPI = {
  auth: authSecurityAPI,
  user: userAPI,
  wallets: walletAPI,
  transactions: transactionAPI,
  cards: cardAPI,
  fx: fxAPI,
  kyc: kycAPI,
  proofOfAddress: proofOfAddressAPI,
  localPayments: localPaymentsAPI,
  usPayments: usPaymentsAPI,
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
  team:         teamAPI,
  webauthn:     webauthnAPI,
};

export default backendAPI;
