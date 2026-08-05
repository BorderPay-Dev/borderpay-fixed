type ReviewDemoAccount = {
  id: string;
  email: string;
  full_name: string;
  account_type: 'individual' | 'business';
  country: string;
  phone: string;
  bridge_customer_id: string;
  company_name?: string;
  walletBalances: Record<'USDC' | 'USDT', number>;
};

const REVIEW_ACCOUNTS: Record<string, ReviewDemoAccount> = {
  'appreview.individual@borderpayafrica.com': {
    id: '5a1a6473-ba4f-413d-8e1b-4464baf1e395',
    email: 'appreview.individual@borderpayafrica.com',
    full_name: 'App Review Individual',
    account_type: 'individual',
    country: 'US',
    phone: '+12405550101',
    bridge_customer_id: 'demo_bridge_customer_app_review_individual',
    walletBalances: { USDC: 245, USDT: 125.5 },
  },
  'appreview.business@borderpayafrica.com': {
    id: '8b2feb9a-6503-421b-bf70-0c23d1aa85b0',
    email: 'appreview.business@borderpayafrica.com',
    full_name: 'App Review Business',
    account_type: 'business',
    country: 'US',
    phone: '+12405550102',
    bridge_customer_id: 'demo_bridge_customer_app_review_business',
    company_name: 'BorderPay Review Demo',
    walletBalances: { USDC: 2450, USDT: 875 },
  },
};

function cacheKey(base: string, userId: string): string {
  return `${base}:${userId}`;
}

function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
}

function nowMinus(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function stableRows(account: ReviewDemoAccount) {
  return [
    {
      id: `demo-wallet-${account.id}-usdc`,
      user_id: account.account_type === 'individual' ? account.id : null,
      business_user_id: account.account_type === 'business' ? account.id : null,
      bridge_customer_id: account.bridge_customer_id,
      bridge_wallet_id: account.account_type === 'individual'
        ? 'demo_wallet_app_review_ind_usdc'
        : 'demo_wallet_app_review_biz_usdc',
      currency: 'USDC',
      chain: 'base',
      address: account.account_type === 'individual'
        ? '0xReviewIndividualUSDC000000000000000000000000'
        : '0xReviewBusinessUSDC0000000000000000000000000',
      status: 'active',
      updated_at: nowMinus(5),
    },
    {
      id: `demo-wallet-${account.id}-usdt`,
      user_id: account.account_type === 'individual' ? account.id : null,
      business_user_id: account.account_type === 'business' ? account.id : null,
      bridge_customer_id: account.bridge_customer_id,
      bridge_wallet_id: account.account_type === 'individual'
        ? 'demo_wallet_app_review_ind_usdt'
        : 'demo_wallet_app_review_biz_usdt',
      currency: 'USDT',
      chain: 'tron',
      address: account.account_type === 'individual'
        ? 'TReviewIndividualUSDT000000000000000000000'
        : 'TReviewBusinessUSDT0000000000000000000000',
      status: 'active',
      updated_at: nowMinus(4),
    },
  ];
}

function walletRows(account: ReviewDemoAccount) {
  return Object.entries(account.walletBalances).map(([currency, balance]) => ({
    id: `canonical:${currency}`,
    user_id: account.id,
    currency,
    balance,
    status: 'active',
    provider: 'bridge',
    source: 'app_review_demo_cache',
    updated_at: nowMinus(3),
    bridge_wallet_id: account.account_type === 'individual'
      ? `demo_wallet_app_review_ind_${currency.toLowerCase()}`
      : `demo_wallet_app_review_biz_${currency.toLowerCase()}`,
    bridge_virtual_account_id: null,
  }));
}

function virtualAccountRows(account: ReviewDemoAccount) {
  const ownerName = account.company_name || account.full_name;
  const owner = {
    user_id: account.account_type === 'individual' ? account.id : null,
    business_user_id: account.account_type === 'business' ? account.id : null,
    bridge_customer_id: account.bridge_customer_id,
    status: 'active',
    updated_at: nowMinus(2),
    developer_fee_percent: 0,
  };
  const prefix = account.account_type === 'individual' ? 'ind' : 'biz';
  return [
    {
      id: `demo-va-${account.id}-usd`,
      ...owner,
      bridge_virtual_account_id: `demo_va_app_review_${prefix}_usd`,
      currency: 'USD',
      rail: 'ach_push',
      account_details: {
        demo: true,
        account_holder_name: ownerName,
        bank_name: 'BorderPay Demo Bank',
        account_number: account.account_type === 'individual' ? '000123456789' : '000987654321',
        routing_number: '021000021',
        bank_address: '1 App Review Way, San Francisco, CA',
      },
    },
    {
      id: `demo-va-${account.id}-eur`,
      ...owner,
      bridge_virtual_account_id: `demo_va_app_review_${prefix}_eur`,
      currency: 'EUR',
      rail: 'sepa',
      account_details: {
        demo: true,
        account_holder_name: ownerName,
        bank_name: 'BorderPay Demo Bank Europe',
        iban: account.account_type === 'individual' ? 'DE89370400440532013000' : 'DE12500105170648489890',
        bic: 'DEMOEULL',
        bank_address: 'Demo Strasse 1, Berlin',
      },
    },
    {
      id: `demo-va-${account.id}-gbp`,
      ...owner,
      bridge_virtual_account_id: `demo_va_app_review_${prefix}_gbp`,
      currency: 'GBP',
      rail: 'faster_payments',
      account_details: {
        demo: true,
        account_holder_name: ownerName,
        bank_name: 'BorderPay Demo Bank UK',
        account_number: account.account_type === 'individual' ? '12345678' : '87654321',
        sort_code: '040004',
        bank_address: '1 Demo Street, London',
      },
    },
  ];
}

function transactionRows(account: ReviewDemoAccount) {
  const isBusiness = account.account_type === 'business';
  return isBusiness
    ? [
      demoTx(account, 'APP-REVIEW-BIZ-001', 'deposit', 2450, 'USDC', 'Demo business funding', 'completed', 180),
      demoTx(account, 'APP-REVIEW-BIZ-002', 'transfer', 320, 'USDC', 'Demo vendor payout in review', 'pending', 60),
      demoTx(account, 'APP-REVIEW-BIZ-003', 'transfer', 150, 'USDT', 'Demo treasury transfer', 'completed', 25),
    ]
    : [
      demoTx(account, 'APP-REVIEW-IND-001', 'deposit', 245, 'USDC', 'Demo wallet funding', 'completed', 180),
      demoTx(account, 'APP-REVIEW-IND-002', 'transfer', 42.5, 'USDC', 'Demo transfer to supplier', 'completed', 70),
      demoTx(account, 'APP-REVIEW-IND-003', 'transfer', 12, 'USDT', 'Demo refunded transfer', 'completed', 20),
    ];
}

function demoTx(
  account: ReviewDemoAccount,
  reference: string,
  type: string,
  amount: number,
  currency: string,
  description: string,
  status: string,
  minutesAgo: number,
) {
  return {
    id: `demo-${reference.toLowerCase()}`,
    user_id: account.id,
    type,
    amount,
    currency,
    status,
    description,
    reference,
    created_at: nowMinus(minutesAgo),
    provider: 'bridge',
    metadata: {
      is_demo: true,
      source: 'app_review',
      direction: type === 'deposit' ? 'credit' : 'debit',
      description,
    },
  };
}

function notificationRows(account: ReviewDemoAccount) {
  return [
    demoNotification(account, 'kyc', 'Demo verification approved', 'This review account is verified for app review.', 160, true),
    demoNotification(account, 'transaction', 'Demo funds received', 'Sample wallet funding is available in the demo balance.', 55, false),
    demoNotification(account, 'transaction', 'Demo transfer update', 'A sample transfer activity is ready to inspect.', 15, false),
  ];
}

function demoNotification(
  account: ReviewDemoAccount,
  type: string,
  title: string,
  body: string,
  minutesAgo: number,
  read: boolean,
) {
  return {
    id: `demo-notification-${account.id}-${minutesAgo}`,
    user_id: account.id,
    type,
    title,
    body,
    read,
    metadata: { is_demo: true, source: 'app_review' },
    created_at: nowMinus(minutesAgo),
  };
}

function profileFor(account: ReviewDemoAccount) {
  return {
    id: account.id,
    email: account.email,
    full_name: account.full_name,
    company_name: account.company_name,
    phone: account.phone,
    country: account.country,
    account_type: account.account_type,
    kyc_status: 'verified',
    kyc_level: 2,
    wallet_activated: true,
    bridge_customer_id: account.bridge_customer_id,
    bridge_kyc_status: account.account_type === 'individual' ? 'approved' : null,
    bridge_kyb_status: account.account_type === 'business' ? 'approved' : null,
    bridge_account_status: 'approved',
    verification_review_status: 'authorized',
    account_status: 'active',
    is_demo: true,
    email_confirmed: true,
    email_confirmed_at: nowMinus(360),
    address: '1 App Review Way',
    city: 'San Francisco',
    state: 'CA',
    postal_code: '94105',
  };
}

function snapshotFor(account: ReviewDemoAccount) {
  const wallets = walletRows(account);
  const virtualAccounts = virtualAccountRows(account);
  const transactions = transactionRows(account);
  const notifications = notificationRows(account);
  return {
    success: true,
    data: {
      profile: profileFor(account),
      wallets,
      transactions,
      stablecoin_wallets: stableRows(account),
      virtual_accounts: virtualAccounts,
      notifications,
      notifications_unread_count: notifications.filter((n) => !n.read).length,
      external_accounts: [],
      external_account_capabilities: ['us', 'iban', 'gb'],
      external_wallets: [],
      external_accounts_partial: false,
      external_wallets_partial: false,
      isReady: true,
      wallet_status: 'active',
      has_funding_surface: true,
      total_balance: wallets.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    },
  };
}

export function isAppReviewDemoEmail(email: string | null | undefined): boolean {
  return Boolean(email && REVIEW_ACCOUNTS[String(email).trim().toLowerCase()]);
}

export function bootstrapAppReviewDemoCache(email: string | null | undefined, authUserId?: string | null): any | null {
  if (typeof window === 'undefined') return null;
  const account = email ? REVIEW_ACCOUNTS[String(email).trim().toLowerCase()] : null;
  if (!account) return null;
  if (authUserId && authUserId !== account.id) return null;

  const profile = profileFor(account);
  const dashboardWallets = Object.entries(account.walletBalances).map(([currency, balance]) => ({
    currency,
    balance,
    symbol: currency === 'USDT' ? '₮' : '$',
    color: currency === 'USDT' ? '#26A17B' : '#2775CA',
  }));
  const stables = stableRows(account);
  const vas = virtualAccountRows(account);
  const transactions = transactionRows(account);
  const notifications = notificationRows(account);
  const snapshot = snapshotFor(account);
  const balances = Object.fromEntries(
    Object.entries(account.walletBalances).map(([currency, balance]) => [currency, balance]),
  );
  const total = Object.values(account.walletBalances).reduce((sum, value) => sum + Number(value || 0), 0);

  try {
    localStorage.setItem('borderpay_user', JSON.stringify(profile));
    localStorage.setItem('borderpay_onboarding_done', 'true');
    localStorage.setItem('borderpay_setup_complete', 'true');
    localStorage.setItem(`borderpay_wallet_total_${account.id}`, String(total));
    localStorage.setItem(`borderpay_wallet_balances_${account.id}`, JSON.stringify(balances));
    localStorage.setItem(cacheKey('borderpay_dashboard_refresh_ts_v1', account.id), String(Date.now()));
    localStorage.setItem(cacheKey('borderpay_wallet_refresh_ts_v1', account.id), String(Date.now()));
    localStorage.setItem(cacheKey('borderpay_notifications_refresh_ts_v1', account.id), String(Date.now()));
  } catch { /* best effort */ }

  writeJSON(cacheKey('borderpay_dash_wallets_v1', account.id), dashboardWallets);
  writeJSON(cacheKey('borderpay_dashboard_va_v1', account.id), vas);
  writeJSON(cacheKey('borderpay_dash_recent_tx_v1', account.id), transactions.slice(0, 5));
  writeJSON(cacheKey('borderpay_wallets_v1', account.id), stables);
  writeJSON(cacheKey('borderpay_va_v1', account.id), vas);
  writeJSON(cacheKey('borderpay_tx_history_v1', account.id), transactions);
  writeJSON(cacheKey('borderpay_notifications_cache:', account.id), {
    rows: notifications,
    cached_at: Date.now(),
  });
  writeJSON(cacheKey('borderpay_snapshot_cache_v1', account.id), {
    at: Date.now(),
    snapshot,
  });

  // Keep Supabase auth session as the auth source; this helper only prepares UI caches.
  return profile;
}
