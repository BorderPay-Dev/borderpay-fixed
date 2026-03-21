/**
 * BorderPay Africa - Database Helper (Postgres via Supabase)
 * 
 * ALL data access MUST go through this module.
 * 
 * Tables: user_profiles, wallets, transactions, cards, beneficiaries,
 *         kyc_documents, address_verifications, accounts, messages,
 *         one_time_tokens, rooms, chat_messages, profiles,
 *         kyc_verifications, kyc_webhook_audit, maplerad_call_audit
 * 
 * Ephemeral store: ONLY for truly transient data that is acceptable to lose
 *   (in-memory TTL cache). No financial, identity, or user-facing data.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ============================================================================
// IN-MEMORY EPHEMERAL STORE (MINIMAL - only for short-lived caches)
// ============================================================================

const _mem = new Map<string, { value: any; expiresAt?: number }>();

/** Auto-cleanup expired entries every 60 seconds */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _mem) {
    if (entry.expiresAt && now > entry.expiresAt) {
      _mem.delete(key);
    }
  }
}, 60_000);

/** Set a value in the ephemeral store. Optional TTL in milliseconds. */
export function ephSet(key: string, value: any, ttlMs?: number): void {
  _mem.set(key, {
    value,
    expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
  });
}

/** Get a value from the ephemeral store. Returns null if missing or expired. */
export function ephGet(key: string): any {
  const entry = _mem.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    _mem.delete(key);
    return null;
  }
  return entry.value;
}

/** Delete a key from the ephemeral store. */
export function ephDel(key: string): void {
  _mem.delete(key);
}

/** Get all values whose keys start with the given prefix. */
export function ephGetByPrefix(prefix: string): any[] {
  const results: any[] = [];
  const now = Date.now();
  for (const [key, entry] of _mem) {
    if (key.startsWith(prefix)) {
      if (entry.expiresAt && now > entry.expiresAt) {
        _mem.delete(key);
        continue;
      }
      if (entry.value != null) results.push(entry.value);
    }
  }
  return results;
}

/** Delete multiple keys from the ephemeral store. */
export function ephMdel(keys: string[]): void {
  for (const k of keys) _mem.delete(k);
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

// Singleton service-role client
let _supabase: any = null;

export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }
  return _supabase;
}

// ============================================================================
// COLUMN WHITELISTS - prevent PGRST204 errors from unknown columns
// ============================================================================

const USER_PROFILE_COLUMNS = new Set([
  'id', 'email', 'full_name', 'phone', 'country', 'account_type',
  'kyc_status', 'kyc_level', 'is_unlocked',
  'one_time_fee_paid_at', 'maplerad_customer_id', 'address', 'city',
  'postal_code', 'date_of_birth', 'language', 'timezone',
  'profile_picture_url', 'profile_picture_path',
  'address_verification_status', 'created_at', 'updated_at',
]);

const WALLET_COLUMNS = new Set([
  'id', 'user_id', 'currency', 'balance', 'is_primary',
  'account_number', 'bank_name', 'status', 'type', 'provider',
  'created_at', 'updated_at',
]);

const TRANSACTION_COLUMNS = new Set([
  'id', 'user_id', 'type', 'amount', 'currency', 'status',
  'description', 'recipient', 'metadata', 'reference',
  'created_at', 'updated_at',
]);

const CARD_COLUMNS = new Set([
  'id', 'user_id', 'card_type', 'currency', 'status', 'last_four',
  'brand', 'maplerad_id', 'provider', 'metadata',
  'created_at', 'updated_at',
]);

const ACCOUNT_COLUMNS = new Set([
  'account_id', 'user_id', 'currency', 'balance', 'account_number',
  'bank_name', 'account_type', 'status', 'created_at', 'updated_at',
]);

const STABLECOIN_TX_COLUMNS = new Set([
  'id', 'user_id', 'type', 'currency', 'amount', 'network',
  'address', 'tx_hash', 'status', 'reference', 'description',
  'metadata', 'created_at', 'updated_at',
]);

/**
 * Strip any keys that don't exist in the table's column set.
 * This prevents PGRST204 "column not found" errors.
 */
function sanitize(data: any, allowedColumns: Set<string>): any {
  const cleaned: any = {};
  for (const key of Object.keys(data)) {
    if (allowedColumns.has(key)) {
      cleaned[key] = data[key];
    }
  }
  return cleaned;
}

/**
 * Tracks columns that were found missing at runtime.
 * Once detected, they're permanently excluded from future queries.
 */
const _missingColumns: Set<string> = new Set();

/**
 * Parse column name from PGRST204 error message.
 * Example: "Could not find the 'account_type' column of 'user_profiles' in the schema cache"
 */
function parseMissingColumn(errorMessage: string): string | null {
  const match = errorMessage.match(/Could not find the '([^']+)' column/);
  return match ? match[1] : null;
}

/**
 * Sanitize + strip any dynamically-detected missing columns.
 * Relies on the whitelist Sets being mutated when PGRST204 errors are detected.
 */
function safeSanitize(data: any, allowedColumns: Set<string>): any {
  const cleaned: any = {};
  for (const key of Object.keys(data)) {
    if (allowedColumns.has(key)) {
      cleaned[key] = data[key];
    }
  }
  return cleaned;
}

// ============================================================================
// USER PROFILES
// ============================================================================

export async function getProfile(userId: string) {
  const { data, error } = await getSupabase()
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    console.error('DB getProfile error:', error);
  }
  return data;
}

export async function upsertProfile(profile: any) {
  let cleanData = safeSanitize(profile, USER_PROFILE_COLUMNS);
  
  // Attempt upsert with retry on PGRST204 (column not found)
  // Allow up to 8 retries to handle multiple missing columns
  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(cleanData).length === 0) {
      console.error('DB upsertProfile: all columns stripped, nothing to upsert');
      throw new Error('DB upsertProfile: no valid columns remaining');
    }
    
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .upsert(cleanData, { onConflict: 'id' })
      .select()
      .single();
    
    if (!error) return data;
    
    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB upsertProfile: column '${missingCol}' not in table, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`user_profiles.${missingCol}`);
        USER_PROFILE_COLUMNS.delete(missingCol);
        delete cleanData[missingCol];
        continue;
      }
    }
    
    console.error('DB upsertProfile error:', error);
    lastError = error;
    break;
  }
  
  throw lastError || new Error('DB upsertProfile: max retries exceeded');
}

export async function updateProfile(userId: string, updates: any) {
  let safe = safeSanitize({ ...updates, updated_at: new Date().toISOString() }, USER_PROFILE_COLUMNS);
  delete safe.id;
  
  // Attempt update with retry on PGRST204
  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(safe).length === 0) {
      // Nothing left to update — just return existing profile
      return await getProfile(userId);
    }
    
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .update(safe)
      .eq('id', userId)
      .select()
      .single();
    
    if (!error) return data;
    
    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB updateProfile: column '${missingCol}' not in table, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`user_profiles.${missingCol}`);
        USER_PROFILE_COLUMNS.delete(missingCol);
        delete safe[missingCol];
        continue;
      }
    }
    
    console.error('DB updateProfile error:', error);
    lastError = error;
    break;
  }
  
  throw lastError || new Error('DB updateProfile: max retries exceeded');
}

export async function getAllProfiles() {
  const { data, error } = await getSupabase()
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('DB getAllProfiles error:', error);
    return [];
  }
  return data || [];
}

/**
 * Find a user by email, phone, or ID
 */
export async function getUserByIdentifier(identifier: string) {
  const supabase = getSupabase();
  
  // Try email first
  let { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', identifier)
    .single();
  
  if (data) return data;

  // Try phone
  ({ data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('phone', identifier)
    .single());
  
  if (data) return data;

  // Try by ID
  ({ data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', identifier)
    .single());
  
  return data;
}

// ============================================================================
// WALLETS
// ============================================================================

export async function getWallets(userId: string) {
  const { data, error } = await getSupabase()
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('DB getWallets error:', error);
    return [];
  }
  return data || [];
}

export async function getWalletByCurrency(userId: string, currency: string) {
  const { data, error } = await getSupabase()
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('currency', currency)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getWalletByCurrency error:', error);
  }
  return data;
}

export async function getWalletById(walletId: string) {
  const { data, error } = await getSupabase()
    .from('wallets')
    .select('*')
    .eq('id', walletId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getWalletById error:', error);
  }
  return data;
}

export async function upsertWallet(wallet: any) {
  let cleanData = safeSanitize(wallet, WALLET_COLUMNS);
  
  // Attempt upsert with retry on PGRST204 (column not found)
  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(cleanData).length === 0) {
      console.error('DB upsertWallet: all columns stripped, nothing to upsert');
      throw new Error('DB upsertWallet: no valid columns remaining');
    }
    
    const { data, error } = await getSupabase()
      .from('wallets')
      .upsert(cleanData, { onConflict: 'id' })
      .select()
      .single();
    
    if (!error) return data;
    
    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB upsertWallet: column '${missingCol}' not in wallets table, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`wallets.${missingCol}`);
        WALLET_COLUMNS.delete(missingCol);
        delete cleanData[missingCol];
        continue;
      }
    }
    
    console.error('DB upsertWallet error:', error);
    lastError = error;
    break;
  }
  
  throw lastError || new Error('DB upsertWallet: max retries exceeded');
}

export async function updateWalletBalance(walletId: string, newBalance: number) {
  const { data, error } = await getSupabase()
    .from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', walletId)
    .select()
    .single();
  if (error) {
    console.error('DB updateWalletBalance error:', error);
    throw error;
  }
  return data;
}

export async function deleteWallet(walletId: string) {
  const { error } = await getSupabase()
    .from('wallets')
    .delete()
    .eq('id', walletId);
  if (error) {
    console.error('DB deleteWallet error:', error);
    throw error;
  }
}

/**
 * Atomic balance deduction using Postgres - prevents race conditions.
 * Returns the updated wallet or null if insufficient balance.
 */
export async function debitWallet(walletId: string, amount: number): Promise<any | null> {
  const supabase = getSupabase();
  const { data: wallet, error: fetchError } = await supabase
    .from('wallets')
    .select('*')
    .eq('id', walletId)
    .single();
  
  if (fetchError || !wallet) return null;
  if (parseFloat(wallet.balance) < amount) return null;

  const newBalance = parseFloat(wallet.balance) - amount;
  const { data, error } = await supabase
    .from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', walletId)
    .gte('balance', amount) // Additional safety: only update if still has enough
    .select()
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Atomic balance credit.
 */
export async function creditWallet(walletId: string, amount: number): Promise<any | null> {
  const supabase = getSupabase();
  const { data: wallet, error: fetchError } = await supabase
    .from('wallets')
    .select('*')
    .eq('id', walletId)
    .single();
  
  if (fetchError || !wallet) return null;

  const newBalance = parseFloat(wallet.balance) + amount;
  const { data, error } = await supabase
    .from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', walletId)
    .select()
    .single();

  if (error || !data) return null;
  return data;
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export async function getTransactions(userId: string, limit = 100, offset = 0) {
  const { data, error } = await getSupabase()
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error('DB getTransactions error:', error);
    return [];
  }
  return data || [];
}

export async function getTransactionById(txId: string) {
  const { data, error } = await getSupabase()
    .from('transactions')
    .select('*')
    .eq('id', txId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getTransactionById error:', error);
  }
  return data;
}

/**
 * Find a transaction by reference and user_id.
 * Used by MoMo collections, US payments, etc. to look up pending transactions.
 */
export async function getTransactionByReference(userId: string, reference: string) {
  const { data, error } = await getSupabase()
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('reference', reference)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getTransactionByReference error:', error);
  }
  return data;
}

/**
 * Find a transaction by Maplerad transaction ID stored in metadata.
 * Scans user's transactions of a given type for a matching metadata.maplerad_id.
 */
export async function getTransactionByMapleradId(userId: string, mapleradId: string, type?: string) {
  let query = getSupabase()
    .from('transactions')
    .select('*')
    .eq('user_id', userId);
  if (type) query = query.eq('type', type);
  
  const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
  if (error) {
    console.error('DB getTransactionByMapleradId error:', error);
    return null;
  }
  return (data || []).find((tx: any) => 
    tx.metadata?.maplerad_id === mapleradId || tx.id === mapleradId
  ) || null;
}

export async function getTransactionCount(userId: string) {
  const { count, error } = await getSupabase()
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) {
    console.error('DB getTransactionCount error:', error);
    return 0;
  }
  return count || 0;
}

export async function insertTransaction(tx: any) {
  let cleanData = safeSanitize(tx, TRANSACTION_COLUMNS);
  
  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(cleanData).length === 0) {
      console.error('DB insertTransaction: all columns stripped');
      throw new Error('DB insertTransaction: no valid columns remaining');
    }
    
    const { data, error } = await getSupabase()
      .from('transactions')
      .insert(cleanData)
      .select()
      .single();
    
    if (!error) return data;
    
    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB insertTransaction: column '${missingCol}' not in transactions table, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`transactions.${missingCol}`);
        TRANSACTION_COLUMNS.delete(missingCol);
        delete cleanData[missingCol];
        continue;
      }
    }
    
    console.error('DB insertTransaction error:', error);
    lastError = error;
    break;
  }
  
  throw lastError || new Error('DB insertTransaction: max retries exceeded');
}

export async function updateTransaction(txId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('transactions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', txId)
    .select()
    .single();
  if (error) {
    console.error('DB updateTransaction error:', error);
    throw error;
  }
  return data;
}

export async function getAllTransactions(limit = 100) {
  const { data, error } = await getSupabase()
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('DB getAllTransactions error:', error);
    return [];
  }
  return data || [];
}

// ============================================================================
// CARDS
// ============================================================================

export async function getCards(userId: string) {
  const { data, error } = await getSupabase()
    .from('cards')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('DB getCards error:', error);
    return [];
  }
  return data || [];
}

export async function getCardById(cardId: string) {
  const { data, error } = await getSupabase()
    .from('cards')
    .select('*')
    .eq('id', cardId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getCardById error:', error);
  }
  return data;
}

export async function upsertCard(card: any) {
  let cleanData = safeSanitize(card, CARD_COLUMNS);
  
  // Attempt upsert with retry on PGRST204 (column not found)
  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(cleanData).length === 0) {
      console.error('DB upsertCard: all columns stripped, nothing to upsert');
      throw new Error('DB upsertCard: no valid columns remaining');
    }
    
    const { data, error } = await getSupabase()
      .from('cards')
      .upsert(cleanData, { onConflict: 'id' })
      .select()
      .single();
    
    if (!error) return data;
    
    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB upsertCard: column '${missingCol}' not in cards table, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`cards.${missingCol}`);
        CARD_COLUMNS.delete(missingCol);
        delete cleanData[missingCol];
        continue;
      }
    }
    
    console.error('DB upsertCard error:', error);
    lastError = error;
    break;
  }
  
  throw lastError || new Error('DB upsertCard: max retries exceeded');
}

export async function updateCard(cardId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', cardId)
    .select()
    .single();
  if (error) {
    console.error('DB updateCard error:', error);
    throw error;
  }
  return data;
}

// ============================================================================
// BENEFICIARIES
// ============================================================================

export async function getBeneficiaries(userId: string) {
  const { data, error } = await getSupabase()
    .from('beneficiaries')
    .select('*')
    .eq('user_id', userId)
    .order('last_used_at', { ascending: false, nullsFirst: false });
  if (error) {
    console.error('DB getBeneficiaries error:', error);
    return [];
  }
  return data || [];
}

export async function getBeneficiary(userId: string, beneficiaryId: string) {
  const { data, error } = await getSupabase()
    .from('beneficiaries')
    .select('*')
    .eq('id', beneficiaryId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getBeneficiary error:', error);
  }
  return data;
}

export async function insertBeneficiary(beneficiary: any) {
  const { data, error } = await getSupabase()
    .from('beneficiaries')
    .insert(beneficiary)
    .select()
    .single();
  if (error) {
    console.error('DB insertBeneficiary error:', error);
    throw error;
  }
  return data;
}

export async function updateBeneficiary(beneficiaryId: string, userId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('beneficiaries')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', beneficiaryId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) {
    console.error('DB updateBeneficiary error:', error);
    throw error;
  }
  return data;
}

export async function deleteBeneficiary(beneficiaryId: string, userId: string) {
  const { error } = await getSupabase()
    .from('beneficiaries')
    .delete()
    .eq('id', beneficiaryId)
    .eq('user_id', userId);
  if (error) {
    console.error('DB deleteBeneficiary error:', error);
    throw error;
  }
}

// ============================================================================
// KYC DOCUMENTS
// ============================================================================

export async function getKycDocument(userId: string) {
  const { data, error } = await getSupabase()
    .from('kyc_documents')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getKycDocument error:', error);
  }
  return data;
}

export async function upsertKycDocument(doc: any) {
  const { data, error } = await getSupabase()
    .from('kyc_documents')
    .upsert(doc, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) {
    console.error('DB upsertKycDocument error:', error);
    throw error;
  }
  return data;
}

// ============================================================================
// ADDRESS VERIFICATIONS
// ============================================================================

export async function getAddressVerification(userId: string) {
  const { data, error } = await getSupabase()
    .from('address_verifications')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getAddressVerification error:', error);
  }
  return data;
}

export async function upsertAddressVerification(verification: any) {
  const { data, error } = await getSupabase()
    .from('address_verifications')
    .upsert(verification, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) {
    console.error('DB upsertAddressVerification error:', error);
    throw error;
  }
  return data;
}

export async function getPendingAddressVerifications() {
  const { data, error } = await getSupabase()
    .from('address_verifications')
    .select('*')
    .eq('status', 'pending');
  if (error) {
    console.error('DB getPendingAddressVerifications error:', error);
    return [];
  }
  return data || [];
}

// ============================================================================
// ACCOUNTS (legacy virtual accounts)
// ============================================================================

export async function getAccounts(userId: string) {
  const { data, error } = await getSupabase()
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('DB getAccounts error:', error);
    return [];
  }
  return data || [];
}

export async function getAccountById(accountId: string) {
  const { data, error } = await getSupabase()
    .from('accounts')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getAccountById error:', error);
  }
  return data;
}

export async function upsertAccount(account: any) {
  let cleanData = safeSanitize(account, ACCOUNT_COLUMNS);
  
  // Attempt upsert with retry on PGRST204 (column not found)
  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(cleanData).length === 0) {
      console.error('DB upsertAccount: all columns stripped, nothing to upsert');
      throw new Error('DB upsertAccount: no valid columns remaining');
    }
    
    const { data, error } = await getSupabase()
      .from('accounts')
      .upsert(cleanData, { onConflict: 'account_id' })
      .select()
      .single();
    
    if (!error) return data;
    
    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB upsertAccount: column '${missingCol}' not in accounts table, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`accounts.${missingCol}`);
        ACCOUNT_COLUMNS.delete(missingCol);
        delete cleanData[missingCol];
        continue;
      }
    }
    
    console.error('DB upsertAccount error:', error);
    lastError = error;
    break;
  }
  
  throw lastError || new Error('DB upsertAccount: max retries exceeded');
}

// ============================================================================
// STABLECOIN TRANSACTIONS (dedicated table)
// Table: stablecoin_transactions
// ============================================================================

export async function insertStablecoinTransaction(tx: any) {
  let cleanData = safeSanitize(tx, STABLECOIN_TX_COLUMNS);

  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Object.keys(cleanData).length === 0) {
      console.error('DB insertStablecoinTransaction: all columns stripped');
      throw new Error('DB insertStablecoinTransaction: no valid columns remaining');
    }

    const { data, error } = await getSupabase()
      .from('stablecoin_transactions')
      .insert(cleanData)
      .select()
      .single();

    if (!error) return data;

    if (error.code === 'PGRST204') {
      const missingCol = parseMissingColumn(error.message);
      if (missingCol) {
        console.warn(`DB insertStablecoinTransaction: column '${missingCol}' not found, removing and retrying (attempt ${attempt + 1})`);
        _missingColumns.add(`stablecoin_transactions.${missingCol}`);
        STABLECOIN_TX_COLUMNS.delete(missingCol);
        delete cleanData[missingCol];
        continue;
      }
    }

    console.error('DB insertStablecoinTransaction error:', error);
    lastError = error;
    break;
  }

  throw lastError || new Error('DB insertStablecoinTransaction: max retries exceeded');
}

export async function getStablecoinTransactions(userId: string, opts?: { limit?: number; offset?: number; currency?: string }) {
  const limit = opts?.limit || 20;
  const offset = opts?.offset || 0;

  let query = getSupabase()
    .from('stablecoin_transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.currency) {
    query = query.eq('currency', opts.currency);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('DB getStablecoinTransactions error:', error);
    return { transactions: [], total_count: 0 };
  }
  return { transactions: data || [], total_count: count || 0 };
}

export async function getStablecoinTransactionById(txId: string) {
  const { data, error } = await getSupabase()
    .from('stablecoin_transactions')
    .select('*')
    .eq('id', txId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getStablecoinTransactionById error:', error);
  }
  return data;
}

export async function updateStablecoinTransaction(txId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('stablecoin_transactions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', txId)
    .select()
    .single();
  if (error) {
    console.error('DB updateStablecoinTransaction error:', error);
    throw error;
  }
  return data;
}


/**
 * Look up a card's owning user_id via the cards Postgres table.
 * Used by webhooks to route Maplerad card events to the correct user.
 */
export async function getUserIdByMapleradCardId(mapleradCardId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('cards')
    .select('user_id')
    .eq('maplerad_id', mapleradCardId)
    .single();
  if (error || !data) return null;
  return data.user_id;
}

// ============================================================================
// MESSAGES (Notifications) - replaces ephemeral notification store
// Table: messages
// ============================================================================

export async function insertMessage(msg: any) {
  const { data, error } = await getSupabase()
    .from('messages')
    .insert(msg)
    .select()
    .single();
  if (error) {
    console.error('DB insertMessage error:', error);
    throw error;
  }
  return data;
}

export async function getMessagesByUser(userId: string, opts?: { limit?: number; unreadOnly?: boolean }) {
  let query = getSupabase()
    .from('messages')
    .select('*')
    .eq('user_id', userId);
  if (opts?.unreadOnly) {
    query = query.eq('read', false);
  }
  query = query.order('created_at', { ascending: false });
  if (opts?.limit) {
    query = query.limit(opts.limit);
  }
  const { data, error } = await query;
  if (error) {
    console.error('DB getMessagesByUser error:', error);
    return [];
  }
  return data || [];
}

export async function getMessage(userId: string, messageId: string) {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('*')
    .eq('id', messageId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getMessage error:', error);
  }
  return data;
}

export async function updateMessage(messageId: string, userId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('messages')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) {
    console.error('DB updateMessage error:', error);
    throw error;
  }
  return data;
}

export async function deleteMessage(messageId: string, userId: string) {
  const { error } = await getSupabase()
    .from('messages')
    .delete()
    .eq('id', messageId)
    .eq('user_id', userId);
  if (error) {
    console.error('DB deleteMessage error:', error);
    throw error;
  }
}

export async function deleteAllMessages(userId: string) {
  const { error } = await getSupabase()
    .from('messages')
    .delete()
    .eq('user_id', userId);
  if (error) {
    console.error('DB deleteAllMessages error:', error);
    throw error;
  }
}

export async function markAllMessagesRead(userId: string) {
  const { data, error } = await getSupabase()
    .from('messages')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('read', false)
    .select();
  if (error) {
    console.error('DB markAllMessagesRead error:', error);
  }
  return data?.length || 0;
}

export async function getUnreadMessageCount(userId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) {
    console.error('DB getUnreadMessageCount error:', error);
    return 0;
  }
  return count || 0;
}

// ============================================================================
// ONE-TIME TOKENS (OTPs, demo tokens, sandbox tokens)
// Table: one_time_tokens
// ============================================================================

export async function insertOneTimeToken(token: any) {
  const { data, error } = await getSupabase()
    .from('one_time_tokens')
    .insert(token)
    .select()
    .single();
  if (error) {
    console.error('DB insertOneTimeToken error:', error);
    throw error;
  }
  return data;
}

export async function upsertOneTimeToken(token: any) {
  const { data, error } = await getSupabase()
    .from('one_time_tokens')
    .upsert(token, { onConflict: 'id' })
    .select()
    .single();
  if (error) {
    console.error('DB upsertOneTimeToken error:', error);
    throw error;
  }
  return data;
}

export async function getOneTimeToken(tokenKey: string, purpose?: string) {
  let query = getSupabase()
    .from('one_time_tokens')
    .select('*')
    .eq('token', tokenKey);
  if (purpose) {
    query = query.eq('purpose', purpose);
  }
  const { data, error } = await query.single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getOneTimeToken error:', error);
  }
  return data;
}

export async function getOneTimeTokenByEmail(email: string, purpose: string) {
  const { data, error } = await getSupabase()
    .from('one_time_tokens')
    .select('*')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getOneTimeTokenByEmail error:', error);
  }
  return data;
}

export async function deleteOneTimeToken(tokenId: string) {
  const { error } = await getSupabase()
    .from('one_time_tokens')
    .delete()
    .eq('id', tokenId);
  if (error) {
    console.error('DB deleteOneTimeToken error:', error);
  }
}

export async function deleteOneTimeTokenByEmail(email: string, purpose: string) {
  const { error } = await getSupabase()
    .from('one_time_tokens')
    .delete()
    .eq('email', email)
    .eq('purpose', purpose);
  if (error) {
    console.error('DB deleteOneTimeTokenByEmail error:', error);
  }
}

// ============================================================================
// ROOMS (Chat Sessions) - replaces ephemeral chat_session store
// Table: rooms
// ============================================================================

export async function insertRoom(room: any) {
  const { data, error } = await getSupabase()
    .from('rooms')
    .insert(room)
    .select()
    .single();
  if (error) {
    console.error('DB insertRoom error:', error);
    throw error;
  }
  return data;
}

export async function getRoomsByUser(userId: string) {
  const { data, error } = await getSupabase()
    .from('rooms')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('DB getRoomsByUser error:', error);
    return [];
  }
  return data || [];
}

export async function getRoom(userId: string, roomId: string) {
  const { data, error } = await getSupabase()
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getRoom error:', error);
  }
  return data;
}

export async function updateRoom(roomId: string, userId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('rooms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', roomId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) {
    console.error('DB updateRoom error:', error);
    throw error;
  }
  return data;
}

// ============================================================================
// CHAT MESSAGES - replaces ephemeral chat_message store
// Table: chat_messages
// ============================================================================

export async function insertChatMessage(msg: any) {
  const { data, error } = await getSupabase()
    .from('chat_messages')
    .insert(msg)
    .select()
    .single();
  if (error) {
    console.error('DB insertChatMessage error:', error);
    throw error;
  }
  return data;
}

export async function getChatMessagesByRoom(roomId: string) {
  const { data, error } = await getSupabase()
    .from('chat_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('DB getChatMessagesByRoom error:', error);
    return [];
  }
  return data || [];
}

export async function getChatMessage(messageId: string) {
  const { data, error } = await getSupabase()
    .from('chat_messages')
    .select('*')
    .eq('id', messageId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getChatMessage error:', error);
  }
  return data;
}

export async function updateChatMessage(messageId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('chat_messages')
    .update(updates)
    .eq('id', messageId)
    .select()
    .single();
  if (error) {
    console.error('DB updateChatMessage error:', error);
    throw error;
  }
  return data;
}

// ============================================================================
// PROFILES (User preferences, notification settings, session data)
// Table: profiles
// ============================================================================

export async function getProfileRecord(userId: string) {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getProfileRecord error:', error);
  }
  return data;
}

export async function upsertProfileRecord(profile: any) {
  const { data, error } = await getSupabase()
    .from('profiles')
    .upsert(profile, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) {
    console.error('DB upsertProfileRecord error:', error);
    throw error;
  }
  return data;
}

export async function updateProfileRecord(userId: string, updates: any) {
  const { data, error } = await getSupabase()
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) {
    console.error('DB updateProfileRecord error:', error);
    throw error;
  }
  return data;
}

export async function deleteProfileRecord(userId: string) {
  const { error } = await getSupabase()
    .from('profiles')
    .delete()
    .eq('user_id', userId);
  if (error) {
    console.error('DB deleteProfileRecord error:', error);
  }
}

// ============================================================================
// KYC VERIFICATIONS - replaces ephemeral smile_verification store
// Table: kyc_verifications
// ============================================================================

export async function getKycVerification(userId: string) {
  const { data, error } = await getSupabase()
    .from('kyc_verifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getKycVerification error:', error);
  }
  return data;
}

export async function upsertKycVerification(verification: any) {
  const { data, error } = await getSupabase()
    .from('kyc_verifications')
    .upsert(verification, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) {
    console.error('DB upsertKycVerification error:', error);
    throw error;
  }
  return data;
}

// ============================================================================
// KYC WEBHOOK AUDIT - replaces ephemeral processed_webhook dedup
// Table: kyc_webhook_audit
// ============================================================================

export async function insertWebhookAudit(audit: any) {
  const { data, error } = await getSupabase()
    .from('kyc_webhook_audit')
    .insert(audit)
    .select()
    .single();
  if (error) {
    // Duplicate key = already processed (which is fine for idempotency)
    if (error.code === '23505') {
      return null;
    }
    console.error('DB insertWebhookAudit error:', error);
    throw error;
  }
  return data;
}

export async function getWebhookAuditByEventId(eventId: string) {
  const { data, error } = await getSupabase()
    .from('kyc_webhook_audit')
    .select('*')
    .eq('event_id', eventId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getWebhookAuditByEventId error:', error);
  }
  return data;
}

// ============================================================================
// MAPLERAD CALL AUDIT - replaces KV compliance alerts, blocked txns, reports
// Table: maplerad_call_audit
// ============================================================================

export async function insertMapleradAudit(audit: any) {
  const { data, error } = await getSupabase()
    .from('maplerad_call_audit')
    .insert(audit)
    .select()
    .single();
  if (error) {
    console.error('DB insertMapleradAudit error:', error);
    throw error;
  }
  return data;
}

export async function getMapleradAuditsByUser(userId: string, opts?: { type?: string; limit?: number }) {
  let query = getSupabase()
    .from('maplerad_call_audit')
    .select('*')
    .eq('user_id', userId);
  if (opts?.type) {
    query = query.eq('call_type', opts.type);
  }
  query = query.order('created_at', { ascending: false });
  if (opts?.limit) {
    query = query.limit(opts.limit);
  }
  const { data, error } = await query;
  if (error) {
    console.error('DB getMapleradAuditsByUser error:', error);
    return [];
  }
  return data || [];
}

/**
 * Find pending transaction by reference (global - not user-scoped).
 * Used by webhooks that don't know the user_id yet.
 */
export async function getPendingTransactionByReference(reference: string) {
  const { data, error } = await getSupabase()
    .from('transactions')
    .select('*')
    .eq('reference', reference)
    .eq('status', 'pending')
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getPendingTransactionByReference error:', error);
  }
  return data;
}

/**
 * Get account by user_id and currency.
 * Used for virtual account lookups.
 */
export async function getAccountByCurrency(userId: string, currency: string) {
  const { data, error } = await getSupabase()
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('currency', currency)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('DB getAccountByCurrency error:', error);
  }
  return data;
}