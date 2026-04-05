/**
 * BorderPay Africa - Backend API Integration
 * Clean API layer — only endpoints actively used by the current UI.
 * All calls go direct to Supabase Edge Functions (no Hono/make-server proxy).
 *
 * Routing: apiCall('edge-function-name', ...) → ${BASE_URL}/edge-function-name
 *
 * Last audit: 2026-03-23
 */

import { authAPI, BASE_URL, ANON_KEY } from '../supabase/client';

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

    if (!response.ok) {
      return {
        success: false,
        error: sanitizeError(data.error || data.message),
      };
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
    if (!response.ok) return { success: false, error: data.error || data.message || `Request failed: ${response.status}` };

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
  async signup(data: {
    email: string;
    password: string;
    full_name: string;
    phone_number: string;
    country_code: string;
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

export const walletAPI = {
  async getWallets() {
    return apiCall('get-wallets', { method: 'POST' });
  },

  async createVirtualAccount(userId: string, currency: string) {
    return apiCall('create-virtual-account', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, currency }),
    });
  },
};

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactionAPI = {
  async getTransactions(limit = 10, offset = 0) {
    return apiCall('get-transactions', {
      method: 'POST',
      body: JSON.stringify({ limit, offset }),
    });
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

export const cardAPI = {
  async createCard(data: {
    card_type?: string;
    brand?: string;
    initial_amount?: number;
    card_name?: string;
    spending_limit?: number;
    design_id?: string;
  }) {
    return apiCall('create-card', {
      method: 'POST',
      body: JSON.stringify({
        card_type: data.card_type || 'virtual',
        brand: data.brand || 'VISA',
        initial_amount: data.initial_amount || 10,
        card_name: data.card_name,
        spending_limit: data.spending_limit,
        design_id: data.design_id,
      }),
    });
  },

  async getCards() {
    return apiCall('get-cards', { method: 'POST' });
  },

  async getCard(cardId: string) {
    return apiCall('get-cards', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },

  async getCardTransactions(cardId: string, filters?: { start_date?: string; end_date?: string; page?: string; page_size?: string }) {
    return apiCall('get-card-transactions', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, ...filters }),
    });
  },

  async fundCard(cardId: string, amount: number) {
    return apiCall('fund-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, amount, wallet_currency: 'USD' }),
    });
  },

  async withdrawCard(cardId: string, amount: number) {
    return apiCall('withdraw-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, amount }),
    });
  },

  async freezeCard(cardId: string) {
    return apiCall('freeze-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },

  async unfreezeCard(cardId: string) {
    return apiCall('unfreeze-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },

  async terminateCard(cardId: string) {
    return apiCall('terminate-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },

  async getCardCharges(filters?: { channel?: string; transaction_id?: string; start_date?: string; end_date?: string; page?: number; page_size?: number; search?: string }) {
    return apiCall('get-card-charges', {
      method: 'POST',
      body: JSON.stringify(filters || {}),
    });
  },
};

// ============================================================================
// FX / EXCHANGE
// ============================================================================

export const fxAPI = {
  async getQuote(sourceCurrency: string, targetCurrency: string, amount: number) {
    return apiCall('fx', {
      method: 'POST',
      body: JSON.stringify({
        action: 'quote',
        source_currency: sourceCurrency,
        target_currency: targetCurrency,
        amount,
      }),
    });
  },

  async convert(data: {
    quote_reference: string | null;
    source_wallet_id: string;
    destination_wallet_id: string;
    amount: number;
    transaction_pin: string;
  }) {
    return apiCall('fx', {
      method: 'POST',
      body: JSON.stringify({ action: 'convert', ...data }),
    });
  },

  async getHistory() {
    return apiCall('get-fx-history', { method: 'POST' });
  },

  async getLiveRates() {
    return apiCall('get-fx-rates', { method: 'POST' });
  },
};

// ============================================================================
// KYC / ENROLLMENT
// ============================================================================

export const kycAPI = {
  async getSmileIdStatus(_userId?: string) {
    return apiCall('query-kyc-status', { method: 'GET' });
  },

  async verifyBVN(bvn: string) {
    return apiCall('verify-bvn', {
      method: 'POST',
      body: JSON.stringify({ bvn }),
    });
  },

  /** Fetch all KYC jobs with optional status filter */
  async getKYCJobs(status?: 'pending' | 'verified' | 'failed' | 'all') {
    const qs = status ? `?status=${status}` : '';
    return apiCall(`get-kyc-jobs${qs}`, { method: 'GET' });
  },
};

export const enrollmentAPI = {
  async enrollCustomer(data: any) {
    return apiCall('enroll-customer-full', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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

  async transfer(data: any) {
    return apiCall('transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async borderPayTransfer(data: any) {
    return apiCall('borderpay-transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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

export const usPaymentsAPI = {
  async transfer(data: any) {
    return apiCall('usd-transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getCounterparties() {
    return apiCall('get-counterparty', { method: 'POST' });
  },

  async createCounterparty(data: any) {
    return apiCall('create-counterparty', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// CRYPTO / STABLECOIN
// ============================================================================

export const addressAPI = {
  async generateAddress(userId: string, currency: string, network: string) {
    return apiCall('generate-address', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, currency, network }),
    });
  },

  async getAddress(addressId: string) {
    return apiCall('get-address', {
      method: 'POST',
      body: JSON.stringify({ address_id: addressId }),
    });
  },

  async updateOfframp(addressId: string, offramp: boolean) {
    return apiCall('update-offramp', {
      method: 'POST',
      body: JSON.stringify({ address_id: addressId, offramp }),
    });
  },
};

export const stablecoinAPI = {
  async logTransaction(data: {
    type: 'deposit' | 'send' | 'receive' | 'swap';
    currency: 'USDC' | 'USDT' | 'PYUSD';
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

  async sendTransfer(data: {
    amount: number;
    reason: string;
    address: string;
    chain: 'base' | 'ethereum' | 'optimism' | 'solana' | 'polygon';
    coin: 'usdc';
    funding_source: 'USD';
    transaction_pin: string;
  }) {
    return apiCall('stablecoin-transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// MOBILE MONEY
// ============================================================================

export const mobileMoneyAPI = {
  async getProviders() {
    return apiCall('get-momo-providers', { method: 'POST' });
  },

  async collect(data: any) {
    return apiCall('mobile-money-collect', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async verifyMomoOTP(transactionId: string, otp: string) {
    return apiCall('verify-momo-otp', {
      method: 'POST',
      body: JSON.stringify({ transaction_id: transactionId, otp }),
    });
  },
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

export const accountsAPI = {
  async getAccounts() {
    return apiCall('get-accounts', { method: 'GET' });
  },

  async createUSDAccount(data: any) {
    return apiCall('create-usd-account', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async checkAccountStatus(reference: string) {
    return apiCall('check-account-status', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    });
  },

  async getSupportedRails(accountId: string) {
    return apiCall('get-account-rails', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
  },

  async createCounterparty(data: any) {
    return apiCall('create-counterparty', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getCounterparty(counterPartyId: string) {
    return apiCall('get-counterparty', {
      method: 'POST',
      body: JSON.stringify({ counter_party_id: counterPartyId }),
    });
  },

  async getAccountCounterparties(accountId: string) {
    return apiCall('get-account-counterparties', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
  },

  async createDynamicAccount(accountName: string, preferredBank: string, amount?: string) {
    return apiCall('create-dynamic-account', {
      method: 'POST',
      body: JSON.stringify({ account_name: accountName, preferred_bank: preferredBank, amount }),
    });
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
// COMBINED BACKEND API — single import for all components
// ============================================================================

export const backendAPI = {
  auth: authSecurityAPI,
  user: userAPI,
  wallets: walletAPI,
  transactions: transactionAPI,
  cards: cardAPI,
  fx: fxAPI,
  kyc: kycAPI,
  enrollment: enrollmentAPI,
  proofOfAddress: proofOfAddressAPI,
  localPayments: localPaymentsAPI,
  usPayments: usPaymentsAPI,
  address: addressAPI,
  stablecoin: stablecoinAPI,
  mobileMoney: mobileMoneyAPI,
  notifications: notificationsAPI,
  accounts: accountsAPI,
  customers: customersAPI,
};

export default backendAPI;
