/**
 * BorderPay Africa - User Initialization
 * Creates user profile and wallets in Postgres (NOT KV)
 */
import * as db from './db.tsx';
import { createMapleradClient } from './maplerad-api.tsx';

function generateAccountNumber(): string {
  return '1' + Math.random().toString().slice(2, 12);
}

export interface UserMetadata {
  full_name: string;
  country: string;
  account_type: string;
  primary_currency?: string;
  phone?: string;
}

/**
 * Create user profile and default wallets in Postgres.
 * Replaces the old KV-based initializeUserInKv.
 */
export async function initializeUserInDb(userId: string, email: string, metadata: UserMetadata) {
  console.log(`👤 Initializing Postgres data for user: ${userId}`);

  // 1. Create Profile in user_profiles table
  const userProfile: any = {
    id: userId,
    email: email,
    full_name: metadata.full_name,
    phone: metadata.phone || '',
    country: metadata.country || 'UNKNOWN',
    account_type: (metadata.account_type || 'individual').toLowerCase(),
    kyc_status: 'pending',
    kyc_level: 0,
    is_unlocked: false,
    one_time_fee_paid_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 1a. Create Maplerad Customer (Tier 0) — skip if already enrolled
  try {
    // Check if user already has a Maplerad customer ID (from a previous attempt)
    const existingProfile = await db.getProfile(userId);
    if (existingProfile?.maplerad_customer_id) {
      userProfile.maplerad_customer_id = existingProfile.maplerad_customer_id;
      console.log(`ℹ️ Maplerad customer already exists: ${existingProfile.maplerad_customer_id}`);
    } else {
      const maplerad = createMapleradClient();
      const nameParts = metadata.full_name.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Customer';

      console.log('🌍 Creating Maplerad Customer (Tier 0)...');
      const customer = await maplerad.createCustomer({
        first_name: firstName,
        last_name: lastName,
        email: email,
        country: metadata.country || 'UNKNOWN'
      });

      if (customer && customer.data && customer.data.id) {
        userProfile.maplerad_customer_id = customer.data.id;
        console.log(`✅ Maplerad Customer Created: ${customer.data.id}`);
      } else {
        console.warn('⚠️ Maplerad customer response did not include ID');
      }
    }
  } catch (error: any) {
    // Handle "already enrolled" gracefully — try to fetch existing customer
    if (error.message?.includes('already enrolled')) {
      console.log('ℹ️ Maplerad customer already enrolled for this email, continuing without re-creating');
      // Try to get the existing profile's maplerad_customer_id
      try {
        const existingProfile = await db.getProfile(userId);
        if (existingProfile?.maplerad_customer_id) {
          userProfile.maplerad_customer_id = existingProfile.maplerad_customer_id;
        }
      } catch (_e) { /* ignore */ }
    } else {
      console.error('⚠️ Failed to create Maplerad customer:', error.message);
    }
    // Non-critical - user can still sign up
  }

  // Save profile to Postgres
  await db.upsertProfile(userProfile);
  console.log('✅ User profile created in Postgres');

  // 2. Determine Wallets to Create
  const FIAT_SUPPORTED: Record<string, string> = {
    'NG': 'NGN', 'GH': 'GHS', 'KE': 'KES', 'UG': 'UGX', 'TZ': 'TZS',
    'CM': 'XAF', 'GA': 'XAF', 'CG': 'XAF', 'TD': 'XAF', 'GQ': 'XAF',
    'CI': 'XOF', 'SN': 'XOF', 'BJ': 'XOF', 'BF': 'XOF', 'GW': 'XOF', 
    'ML': 'XOF', 'NE': 'XOF', 'TG': 'XOF'
  };

  const localCurrency = FIAT_SUPPORTED[metadata.country || 'UNKNOWN'];
  const walletsToCreate = ['USD'];
  if (localCurrency && localCurrency !== 'USD') {
    walletsToCreate.push(localCurrency);
  }

  const newWalletsList: any[] = [];

  for (const currency of walletsToCreate) {
    const isPrimary = currency === 'USD';
    const walletId = crypto.randomUUID();

    const walletEntry = {
      id: walletId,
      user_id: userId,
      currency: currency,
      balance: 0,
      is_primary: isPrimary,
      account_number: generateAccountNumber(),
      bank_name: 'BorderPay',
      status: 'active',
      created_at: new Date().toISOString(),
      type: 'fiat',
      provider: 'maplerad',
    };

    // Save wallet to Postgres
    await db.upsertWallet(walletEntry);
    newWalletsList.push(walletEntry);

    // Also save as account (legacy compat)
    await db.upsertAccount({
      account_id: crypto.randomUUID(),
      user_id: userId,
      currency: currency,
      balance: 0,
      account_number: walletEntry.account_number,
      bank_name: 'BorderPay',
      account_type: 'checking',
      status: 'active',
      created_at: new Date().toISOString(),
    });
  }

  console.log(`✅ Wallets created: ${walletsToCreate.join(', ')}`);

  return { profile: userProfile, wallets: newWalletsList };
}