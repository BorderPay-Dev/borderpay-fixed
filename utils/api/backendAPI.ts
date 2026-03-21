/**
 * BorderPay Africa - Backend API Integration
 * Complete API service layer for all 70+ deployed Supabase Edge Functions
 * This replaces ALL mock data with real backend calls
 *
 * Routing convention:
 *   Financial & sensitive data -> apiCall('edge-function-name', ...)
 *     Direct to Supabase Edge Functions, no middleware
 *   Non-financial (auth signup/signin, notifications preferences)
 *     -> apiCall(`${S}/sub-route`, ...) via Hono server
 *
 * Last audit: 2026-03-17
 */

import { authAPI, hasSupabase, SERVER_URL, BASE_URL, ANON_KEY } from '../supabase/client';

/**
 * Server route prefix – resolves to the VITE_SERVER_FUNCTION env var
 * (or the legacy make-server name as fallback).
 * All calls go through apiCall() which handles auth headers automatically.
 */
const S = import.meta.env.VITE_SERVER_FUNCTION || 'make-server-8714b62b';
const D = `${S}/direct`;

// Helper function to make authenticated API calls
async function apiCall<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const token = authAPI.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      // Supabase gateway requires apikey header to reach Edge Functions
      'apikey': publicAnonKey,
      ...options.headers,
    };

    // Send user JWT if authenticated; fall back to anon key for gateway access
    headers['Authorization'] = `Bearer ${token || publicAnonKey}`;

    const response = await fetch(`${BASE_URL}/${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`API Error [${endpoint}]:`, data);
      return {
        success: false,
        error: data.error || data.message || `Request failed with status ${response.status}`,
      };
    }

    console.log(`API Success [${endpoint}]:`, data);

    // If the server already returns { success, data } shape (e.g. Hono routes),
    // return it as-is to avoid double-wrapping
    if (data && typeof data === 'object' && 'success' in data) {
      return data;
    }

    return { success: true, data };
  } catch (error: any) {
    // Silently handle aborted requests (e.g. from polling cleanup)
    if (error?.name === 'AbortError') {
      return { success: false, error: 'Request aborted' };
    }
    // Suppress noisy logs for background polling endpoints
    const silentEndpoints = ['notifications/unread-count'];
    const isSilent = silentEndpoints.some(e => endpoint.includes(e));
    if (!isSilent) {
      console.error(`API Exception [${endpoint}]:`, error);
    }
    return {
      success: false,
      error: error.message || 'Unable to connect to our servers. Please check your internet connection and try again.',
    };
  }
}

/**
 * Unauthenticated API call (uses publicAnonKey). For signup/public routes only.
 */
async function apiCallPublic<T = any>(
  endpoint: string,
  options: RequestInit = {},
  anonKey?: string
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const key = anonKey || publicAnonKey;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      ...options.headers,
    };

    const response = await fetch(`${BASE_URL}/${endpoint}`, { ...options, headers });
    const data = await response.json();
    if (!response.ok) return { success: false, error: data.error || data.message || `Request failed: ${response.status}` };

    // If the server already returns { success, data } shape, return as-is
    if (data && typeof data === 'object' && 'success' in data) {
      return data;
    }

    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unable to connect to our servers. Please check your internet connection.' };
  }
}

// ============================================================================
// AUTH & SECURITY APIs
// ============================================================================

export const authSecurityAPI = {
  async signup(data: {
    email: string;
    password: string;
    full_name: string;
    phone_number: string;
    country_code: string;
  }, anonKey: string) {
    return apiCallPublic(`${S}/auth/signup`, {
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

  async mfaTOTP(userId: string, code: string) {
    return apiCall('mfa_totp', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, code }),
    });
  },

  async mfaAuditRateLimit(userId: string, action: string) {
    return apiCall(`${S}/get-security-status`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, action }),
    });
  },

  /** GET security status - Hono server route (Postgres read-only) */
  async getSecurityStatus(userId: string) {
    return apiCall(`${S}/get-security-status`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async enableBiometric(userId: string, publicKey: string) {
    return apiCall('enable-biometric', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, public_key: publicKey }),
    });
  },

  async biometricAuth(userId: string, credentialId: string, signature: string) {
    return apiCall('biometric-auth', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, credential_id: credentialId, signature }),
    });
  },

  async resetPasswordRequest(email: string) {
    return apiCall(`${S}/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPasswordConfirm(token: string, newPassword: string) {
    return apiCall(`${S}/auth/reset-password/confirm`, {
      method: 'POST',
      body: JSON.stringify({ access_token: token, new_password: newPassword }),
    });
  },

  /** Verify auth callback (e.g. email link, OAuth redirect) */
  async verifyCallback(data: any) {
    return apiCall('auth-verify-callback', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** Consume and send auth challenge (email/SMS OTP) */
  async verifyAuthChallenge(data: any) {
    return apiCall('verify_auth_challenge_consume_and_send', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// WALLET APIs
// ============================================================================

export const walletAPI = {
  /** GET wallets - Hono server route (Postgres read-only) */
  async getWallets() {
    return apiCall(`${S}/get-wallets`, { method: 'POST' });
  },

  async activateWallets() {
    return apiCall('activate-wallets', { method: 'POST' });
  },

  async createVirtualAccount(userId: string, currency: string) {
    return apiCall('create-virtual-account', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, currency }),
    });
  },

  async createUSDAccount(userId: string) {
    return apiCall('create-usd-account', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async createDynamicAccount(userId: string, currency: string) {
    return apiCall('create-dynamic-account', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, currency }),
    });
  },

  async getCustomerAccounts(customerId: string) {
    return apiCall('get-customer-accounts', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId }),
    });
  },

  async getVirtualAccount(accountId: string) {
    return apiCall('get-virtual-account', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
  },

  async getCustomerVirtualAccounts(customerId: string) {
    return apiCall('get-customer-virtual-accounts', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId }),
    });
  },

  async creditWallet(userId: string, walletId: string, amount: number, idempotencyKey: string) {
    return apiCall('credit-wallet-idempotent', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, wallet_id: walletId, amount, idempotency_key: idempotencyKey }),
    });
  },
};

// ============================================================================
// TRANSACTION APIs
// ============================================================================

export const transactionAPI = {
  /** GET paginated transactions - Hono server route (Postgres read-only) */
  async getTransactions(limit = 10, offset = 0) {
    return apiCall(`${S}/get-transactions-list`, {
      method: 'POST',
      body: JSON.stringify({ limit, offset }),
    });
  },

  /** GET dashboard summary (profile + wallets + recent txns) - standalone Edge Function */
  async getDashboardSummary() {
    return apiCall('get-dashboard-summary', { method: 'POST' });
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

  async importTransactions(userId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);
    return apiCall('import-transactions', {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },

  async verifyTransaction(transactionId: string) {
    return apiCall('verify-transaction', {
      method: 'POST',
      body: JSON.stringify({ transaction_id: transactionId }),
    });
  },

  async getTransferFee(amount: number, currency: string, type: string) {
    return apiCall('get_transfer_fee', {
      method: 'POST',
      body: JSON.stringify({ amount, currency, type }),
    });
  },
};

// ============================================================================
// VIRTUAL CARD APIs  (Standalone Edge Functions — Maplerad card issuance)
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
    return apiCall(`${S}/get-cards`, { method: 'POST' });
  },

  async getCard(cardId: string) {
    return apiCall(`${S}/get-cards`, {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },

  async fundCard(cardId: string, amount: number) {
    return apiCall('maplerad-fund-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, amount, wallet_currency: 'USD' }),
    });
  },

  async withdrawCard(cardId: string, amount: number) {
    return apiCall('maplerad-withdraw-card', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, amount }),
    });
  },

  async freezeCard(cardId: string) {
    return apiCall('maplerad-proxy-freeze', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },

  async unfreezeCard(cardId: string) {
    return apiCall('maplerad-proxy-unfreeze', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId }),
    });
  },
};

// ============================================================================
// BENEFICIARY APIs
// ============================================================================

export const beneficiaryAPI = {
  async getBeneficiaries(userId: string) {
    return apiCall('get-beneficiaries', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async addBeneficiary(data: any) {
    return apiCall('add-beneficiary', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateBeneficiary(beneficiaryId: string, data: any) {
    return apiCall('update-beneficiary', {
      method: 'POST',
      body: JSON.stringify({ beneficiary_id: beneficiaryId, ...data }),
    });
  },

  async deleteBeneficiary(beneficiaryId: string) {
    return apiCall('delete-beneficiary', {
      method: 'POST',
      body: JSON.stringify({ beneficiary_id: beneficiaryId }),
    });
  },
};

// ============================================================================
// USER / PROFILE APIs
// ============================================================================

export const userAPI = {
  /** GET profile - routes to dedicated user-profile-direct module (Postgres + Auth merge) */
  async getProfile() {
    return apiCall(`${D}/user/profile`, { method: 'GET' });
  },

  /** PUT profile - routes to dedicated user-profile-direct module (Postgres + Auth sync) */
  async updateProfile(data: any) {
    return apiCall(`${D}/user/profile`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /** POST profile picture - routes to dedicated user-profile-direct module (Storage + Postgres) */
  async uploadProfilePicture(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return apiCall(`${D}/user/profile-picture`, {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
};

// ============================================================================
// FX / EXCHANGE APIs  (single `fx` Edge Function handles all three actions)
// ============================================================================

export const fxAPI = {
  /** Generate an FX quote */
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

  /** Execute a currency conversion */
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

  /** Get FX transaction history */
  async getHistory(userId: string, filters?: any) {
    return apiCall('fx', {
      method: 'POST',
      body: JSON.stringify({ action: 'history', user_id: userId, ...filters }),
    });
  },
};

// ============================================================================
// KYC APIs
// ============================================================================

export const kycAPI = {
  /** Poll SmileID verification status via the deployed callback handler */
  async getSmileIdStatus(userId: string) {
    return apiCall(`${S}/smile-callback-handler`, {
      method: 'GET',
      headers: { 'X-User-Id': userId },
    });
  },

  /** SmileID callback handler (server-to-server, but available for status polling) */
  async smileCallback(data: any) {
    return apiCall(`${S}/smile-callback-handler`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// ENROLLMENT APIs
// ============================================================================

export const enrollmentAPI = {
  async enrollCustomer(data: any) {
    return apiCall('enroll-customer-full', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// PROOF OF ADDRESS APIs
// ============================================================================

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
// LOCAL PAYMENT APIs (Bank transfers, Mobile Money)
// ============================================================================

export const localPaymentsAPI = {
  async getInstitutions(currency: string, type?: string) {
    return apiCall('get-institutions', {
      method: 'POST',
      body: JSON.stringify({ currency, type }),
    });
  },

  async resolveAccount(bankCode: string, accountNumber: string, currency: string) {
    return apiCall('resolve-account', {
      method: 'POST',
      body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber, currency }),
    });
  },

  async transfer(data: any) {
    return apiCall('maplerad_transfers', {
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
};

// ============================================================================
// US PAYMENT APIs (ACH / Wire)
// ============================================================================

export const usPaymentsAPI = {
  async transfer(data: any) {
    return apiCall('maplerad_transfers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getCounterparties() {
    return apiCall('get-counterparty', { method: 'POST' });
  },

  async createCounterparty(data: any) {
    return apiCall('maplerad-create-counterparty', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// CRYPTO / STABLECOIN ADDRESS APIs
// ============================================================================

export const addressAPI = {
  /** Get existing address for a currency/network */
  async getAddress(userId: string, currency: string, network: string) {
    return apiCall('get-address', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, currency, network }),
    });
  },

  /** Generate a new deposit address */
  async generateAddress(userId: string, currency: string, network: string) {
    return apiCall('generate-address', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, currency, network }),
    });
  },
};

// ============================================================================
// STABLECOIN TRANSACTION APIs (Hono server → Postgres)
// ============================================================================

export const stablecoinAPI = {
  /** Log a stablecoin transaction to Postgres */
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
    return apiCall(`${S}/log-stablecoin-transaction`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** Get stablecoin transactions from Postgres */
  async getTransactions(limit = 20, offset = 0, currency?: string) {
    return apiCall(`${S}/get-stablecoin-transactions`, {
      method: 'POST',
      body: JSON.stringify({ limit, offset, currency }),
    });
  },
};

// ============================================================================
// MOBILE MONEY APIs
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
// CUSTOMER MANAGEMENT APIs
// ============================================================================

export const customersAPI = {
  async suspendUser(userId: string, reason: string) {
    return apiCall('suspend-user', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, reason }),
    });
  },

  async resumeUser(userId: string) {
    return apiCall('resume-user', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async searchUsers(query: string, filters?: any) {
    return apiCall('search_users', {
      method: 'POST',
      body: JSON.stringify({ query, ...filters }),
    });
  },

  async setCustomerActive(userId: string, active: boolean) {
    return apiCall('set-customer-active', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, active }),
    });
  },

  async upgradeTier2(userId: string) {
    return apiCall('upgrade-tier2', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  /** Proxy to banking provider customer endpoints */
  async mapleradCustomersProxy(action: string, data?: any) {
    return apiCall('maplerad_customers_proxy', {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
    });
  },

  /** Update customer details via Maplerad */
  async updateCustomer(data: any) {
    return apiCall('update-customer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// ACCOUNTS APIs
// ============================================================================

export const accountsAPI = {
  async createUSDAccount(data: any) {
    return apiCall('create-usd-account', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async reconcileAccounts(data?: any) {
    return apiCall('reconcile-accounts', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },
};

// ============================================================================
// NOTIFICATIONS APIs  (Direct Edge Function)
// ============================================================================

export const notificationsAPI = {
  async notifyUsers(data: any) {
    return apiCall('notify-users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getUnreadCount(signal?: AbortSignal) {
    return apiCall(`${S}/notifications/unread-count`, { method: 'GET', signal });
  },

  async getNotifications(limit: number = 20) {
    return apiCall(`${S}/notifications?limit=${limit}`, { method: 'GET' });
  },

  async markAsRead(notificationId: string) {
    return apiCall(`${S}/notifications/${notificationId}/read`, { method: 'POST' });
  },

  async markAllAsRead() {
    return apiCall(`${S}/notifications/mark-all-read`, { method: 'POST' });
  },

  async deleteNotification(notificationId: string) {
    return apiCall(`${S}/notifications/${notificationId}`, { method: 'DELETE' });
  },

  async clearAll() {
    return apiCall(`${S}/notifications/clear`, { method: 'DELETE' });
  },
};

// ============================================================================
// CHAT / SUPPORT APIs  (Direct Edge Function: live-chat-support)
// ============================================================================

export const chatAPI = {
  async getSessions() {
    return apiCall('live-chat-support', {
      method: 'POST',
      body: JSON.stringify({ action: 'get_sessions' }),
    });
  },

  async createSession(topic: string) {
    return apiCall('live-chat-support', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_session', topic }),
    });
  },

  async getMessages(sessionId: string) {
    return apiCall('live-chat-support', {
      method: 'POST',
      body: JSON.stringify({ action: 'get_messages', session_id: sessionId }),
    });
  },

  async sendMessage(sessionId: string, message: string) {
    return apiCall('live-chat-support', {
      method: 'POST',
      body: JSON.stringify({ action: 'send_message', session_id: sessionId, message }),
    });
  },
};

// ============================================================================
// SAVINGS GOALS APIs  (Direct Edge Functions)
// ============================================================================

export const savingsAPI = {
  async getSavingsGoals(userId: string) {
    return apiCall('get-savings-goals', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  /** Alias: saving_goals_list (legacy endpoint) */
  async listSavingsGoals(userId: string) {
    return apiCall('saving_goals_list', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async createSavingsGoal(userId: string, data: any) {
    return apiCall('create-savings-goal', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ...data }),
    });
  },

  /** Alias: saving_goals_create (legacy endpoint) */
  async createSavingsGoalLegacy(userId: string, data: any) {
    return apiCall('saving_goals_create', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ...data }),
    });
  },

  async updateSavingsGoal(goalId: string, data: any) {
    return apiCall('update-savings-goal', {
      method: 'POST',
      body: JSON.stringify({ goal_id: goalId, ...data }),
    });
  },

  async fundSavingsGoal(goalId: string, amount: number, walletId: string) {
    return apiCall('fund-savings-goal', {
      method: 'POST',
      body: JSON.stringify({ goal_id: goalId, amount, wallet_id: walletId }),
    });
  },

  async deleteSavingsGoal(goalId: string) {
    return apiCall('delete-savings-goal', {
      method: 'POST',
      body: JSON.stringify({ goal_id: goalId }),
    });
  },
};

// ============================================================================
// SCHEDULED TRANSFERS APIs  (Direct Edge Functions)
// ============================================================================

export const scheduledTransfersAPI = {
  async getScheduledTransfers(userId: string) {
    return apiCall('get-scheduled-transfers', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async createScheduledTransfer(userId: string, data: any) {
    return apiCall('create-scheduled-transfer', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ...data }),
    });
  },

  async updateScheduledTransfer(transferId: string, data: any) {
    return apiCall('update-scheduled-transfer', {
      method: 'POST',
      body: JSON.stringify({ transfer_id: transferId, ...data }),
    });
  },

  async pauseScheduledTransfer(transferId: string, paused: boolean) {
    return apiCall('pause-scheduled-transfer', {
      method: 'POST',
      body: JSON.stringify({ transfer_id: transferId, paused }),
    });
  },

  async deleteScheduledTransfer(transferId: string) {
    return apiCall('delete-scheduled-transfer', {
      method: 'POST',
      body: JSON.stringify({ transfer_id: transferId }),
    });
  },
};

// ============================================================================
// ANALYTICS APIs  (Direct Edge Function: get-analytics)
// ============================================================================

export const analyticsAPI = {
  async getAnalytics(userId: string, timeRange?: string) {
    return apiCall('get-analytics', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, range: timeRange }),
    });
  },

  async getTransactionInsights(userId: string, timeRange: string) {
    return apiCall('get-analytics', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, range: timeRange, type: 'insights' }),
    });
  },

  async generateSpendingReport(userId: string, data?: any) {
    return apiCall('generate-spending-report', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ...data }),
    });
  },

  async generateReport(userId: string, data: any) {
    return apiCall('generate-report', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, ...data }),
    });
  },
};

// ============================================================================
// MAPLERAD PROXY APIs  (Admin / internal operations)
// ============================================================================

export const mapleradProxyAPI = {
  async getCharges(data?: any) {
    return apiCall('maplerad-proxy-charges', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  async freezeAccount(data: any) {
    return apiCall('maplerad-proxy-freeze', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async unfreezeAccount(data: any) {
    return apiCall('maplerad-proxy-unfreeze', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async terminateAccount(data: any) {
    return apiCall('maplerad-proxy-terminate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getTransactions(data?: any) {
    return apiCall('maplerad-proxy-transactions', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },
};

// ============================================================================
// FEES / CONFIG APIs
// ============================================================================

export const feesAPI = {
  async getFeesConfig() {
    return apiCall('fees-config-json', { method: 'POST' });
  },
};

// ============================================================================
// REALTIME PROXY APIs
// ============================================================================

export const realtimeAPI = {
  async connect(data: any) {
    return apiCall('realtime-proxy', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// COMBINED BACKEND API - single import for all components
// ============================================================================

export const backendAPI = {
  auth: authSecurityAPI,
  wallets: walletAPI,
  transactions: transactionAPI,
  cards: cardAPI,
  beneficiaries: beneficiaryAPI,
  user: userAPI,
  fx: fxAPI,
  kyc: kycAPI,
  enrollment: enrollmentAPI,
  proofOfAddress: proofOfAddressAPI,
  localPayments: localPaymentsAPI,
  usPayments: usPaymentsAPI,
  address: addressAPI,
  mobileMoney: mobileMoneyAPI,
  customers: customersAPI,
  accounts: accountsAPI,
  notifications: notificationsAPI,
  chat: chatAPI,
  savings: savingsAPI,
  scheduledTransfers: scheduledTransfersAPI,
  analytics: analyticsAPI,
  mapleradProxy: mapleradProxyAPI,
  fees: feesAPI,
  realtime: realtimeAPI,
  stablecoin: stablecoinAPI,
};

export default backendAPI;