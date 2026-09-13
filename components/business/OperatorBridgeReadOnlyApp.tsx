import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Bell, CheckCircle2, Copy, Eye, EyeOff, Home,
  Landmark, LogOut, ReceiptText, RefreshCw, Send, WalletCards, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';

type WalletRow = {
  id: string;
  currency: string;
  chain: string;
  address: string;
  status: string;
  balance_available: boolean;
  balances: Array<{ currency: string; chain: string; balance: string }>;
};

type CustomerTransaction = {
  id: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  account_type: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  fee: string;
  description: string;
  reference: string;
  created_at: string;
  updated_at: string;
};

type TreasuryNotification = {
  id: string;
  customer_name: string;
  customer_email: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

type TreasuryExternalAccount = {
  id: string;
  account_type: string;
  currency: 'USD' | 'EUR' | 'GBP';
  rail: string;
  status: string;
  account_owner_name: string;
  bank_name: string;
  last_4: string;
};

type OperatorSnapshot = {
  access_mode: 'read_only';
  account: { name: string; customer_id: string; status: string };
  wallets: WalletRow[];
  virtual_accounts: Array<{
    id: string;
    currency: string;
    rail: string;
    status: string;
    account_holder_name: string;
    bank_name: string;
    bank_address: string;
    account_number: string;
    routing_number: string;
    iban: string;
    bic: string;
    created_at: string;
  }>;
  external_accounts: TreasuryExternalAccount[];
  external_accounts_available: boolean;
  transactions: Array<{
    id: string;
    state: string;
    source: { currency: string; payment_rail: string; amount: string };
    destination: { currency: string; payment_rail: string; amount: string };
    created_at: string;
    updated_at: string;
  }>;
  customer_transactions: CustomerTransaction[];
  notifications: TreasuryNotification[];
  platform_activity_available: boolean;
  refreshed_at: string;
};

type TreasuryView = 'home' | 'wallets' | 'receive' | 'transactions' | 'send';

const TREASURY_NAV = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'wallets', label: 'Wallet', icon: WalletCards },
  { id: 'receive', label: 'Accounts', icon: Landmark },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'send', label: 'Send', icon: Send },
] satisfies Array<{ id: TreasuryView; label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> }>;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C7FF00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07090D]';

function title(value: string): string {
  return String(value || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortId(value: string): string {
  if (!value || value.length < 18) return value || '—';
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMoney(value: string | number, currency: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return `— ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
  } catch {
    return `${number.toFixed(2)} ${currency}`;
  }
}

function copy(value: string, label: string) {
  if (!value) return;
  void navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error(`Could not copy ${label.toLowerCase()}`),
  );
}

function walletBalance(wallet: WalletRow): number | null {
  if (!wallet.balance_available) return null;
  return wallet.balances.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
}

export function OperatorBridgeReadOnlyApp({ onLogout }: { onLogout: () => void }) {
  const [activeView, setActiveView] = useState<TreasuryView>('home');
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(false);
  const [sourceSelection, setSourceSelection] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [destinationType, setDestinationType] = useState<'wallet' | 'bank'>('wallet');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [sendStep, setSendStep] = useState<'details' | 'pin' | 'submitting' | 'success'>('details');
  const [pin, setPin] = useState('');
  const [transferResult, setTransferResult] = useState<{ transfer_id: string; state: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const response = await backendAPI.bridge.operator.getSnapshot();
    if (!response.success || !response.data) {
      setError(response.error || 'Treasury data is temporarily unavailable.');
      setLoading(false);
      return;
    }
    setSnapshot(response.data as OperatorSnapshot);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The treasury owns the viewport while mounted. Keeping the document fixed
  // prevents a second browser scrollbar; wheel, keyboard and touch scrolling
  // remain available on the treasury shell itself.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.add('bp-treasury-active');
    body.classList.add('bp-treasury-active');
    return () => {
      root.classList.remove('bp-treasury-active');
      body.classList.remove('bp-treasury-active');
    };
  }, []);

  const assetRows = useMemo(() => (snapshot?.wallets || []).map((wallet) => ({ ...wallet, balance: walletBalance(wallet) })), [snapshot]);
  const usdTotal = useMemo(() => assetRows.filter((row) => row.currency === 'USDC' || row.currency === 'USDT').reduce((sum, row) => sum + (row.balance || 0), 0), [assetRows]);
  const unreadNotifications = snapshot?.notifications.filter((notification) => !notification.read).length || 0;
  const recentTransactions = snapshot?.customer_transactions.slice(0, 6) || [];
  const sendSources = useMemo(() => assetRows.filter((wallet) => wallet.balance !== null).map((wallet) => ({
    key: `${wallet.id}:${wallet.currency}`,
    wallet_id: wallet.id,
    currency: wallet.currency,
    chain: wallet.chain,
    balance: String(wallet.balance || 0),
  })), [assetRows]);
  const selectedSource = sendSources.find((source) => source.key === sourceSelection) || null;
  const selectedExternalAccount = snapshot?.external_accounts.find((account) => account.id === externalAccountId) || null;

  const navigate = (view: TreasuryView) => {
    setActiveView(view);
    setNotificationsOpen(false);
  };

  const resetSend = () => {
    setSendStep('details');
    setPin('');
    setSendAmount('');
    setDestinationType('wallet');
    setDestinationAddress('');
    setExternalAccountId('');
    setTransferResult(null);
    setIdempotencyKey(crypto.randomUUID());
  };

  const submitTransfer = async () => {
    if (!selectedSource) return;
    if (destinationType === 'bank' && !selectedExternalAccount) {
      toast.error('Choose an active external bank account.');
      return;
    }
    setSendStep('submitting');
    const response = await backendAPI.bridge.operator.send({
      source_wallet_id: selectedSource.wallet_id,
      currency: selectedSource.currency,
      destination_rail: destinationType === 'bank' ? (selectedExternalAccount?.rail || '') : selectedSource.chain,
      destination_address: destinationType === 'wallet' ? destinationAddress.trim() : '',
      destination_external_account_id: destinationType === 'bank' ? (selectedExternalAccount?.id || '') : '',
      destination_currency: destinationType === 'bank' ? (selectedExternalAccount?.currency || '') : '',
      amount: sendAmount.trim(),
      idempotency_key: idempotencyKey,
      pin,
    });
    if (!response.success || !response.data) {
      setSendStep('pin');
      setPin('');
      toast.error(response.error || 'Transfer was not submitted.');
      return;
    }
    setTransferResult(response.data);
    setSendStep('success');
    await load();
  };

  return (
    <div className="bp-treasury-shell bp-treasury-scroll fixed inset-0 h-dvh overflow-y-auto overflow-x-hidden bg-[#07090D] text-white">
      <style>{`
        html.bp-treasury-active,body.bp-treasury-active{height:100%;overflow:hidden!important;overscroll-behavior:none}
        html.bp-treasury-active,body.bp-treasury-active,#root{scrollbar-width:none;-ms-overflow-style:none}
        html.bp-treasury-active::-webkit-scrollbar,body.bp-treasury-active::-webkit-scrollbar,#root::-webkit-scrollbar{display:none;width:0;height:0}
        .bp-treasury-shell{height:100vh;height:100svh;height:100dvh;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch;-webkit-text-size-adjust:100%;scrollbar-gutter:auto}
        .bp-treasury-scroll{scrollbar-width:none;-ms-overflow-style:none}
        .bp-treasury-scroll::-webkit-scrollbar{display:none;width:0;height:0}
        .bp-treasury-header{padding-top:env(safe-area-inset-top,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}
        .bp-treasury-main{padding-left:max(1rem,env(safe-area-inset-left,0px));padding-right:max(1rem,env(safe-area-inset-right,0px))}
        .bp-treasury-bottom-nav{padding-right:max(.5rem,env(safe-area-inset-right,0px));padding-bottom:max(.5rem,env(safe-area-inset-bottom,0px));padding-left:max(.5rem,env(safe-area-inset-left,0px))}
        @media (min-width:640px){.bp-treasury-main{padding-left:max(1.5rem,env(safe-area-inset-left,0px));padding-right:max(1.5rem,env(safe-area-inset-right,0px))}}
        @media (min-width:1024px){.bp-treasury-main{padding-left:max(2.5rem,env(safe-area-inset-left,0px));padding-right:max(2.5rem,env(safe-area-inset-right,0px))}}
        @media (display-mode:standalone){.bp-treasury-shell{height:100dvh}.bp-treasury-header{touch-action:pan-y}.bp-treasury-bottom-nav{touch-action:manipulation}}
        @media (max-width:359px){.bp-treasury-brand-copy{display:none}.bp-treasury-nav-label{font-size:9px}.bp-treasury-card{border-radius:1.25rem}}
        @media (orientation:landscape) and (max-height:540px) and (max-width:900px){.bp-treasury-header-inner{min-height:3.5rem}.bp-treasury-bottom-nav button{min-height:2.75rem}.bp-treasury-bottom-nav .bp-treasury-nav-label{display:none}.bp-treasury-main{padding-top:1rem}}
        @media (prefers-reduced-motion:reduce){.bp-treasury-shell *{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
      `}</style>
      <a href="#treasury-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-black">Skip to treasury content</a>

      <header className="bp-treasury-header sticky top-0 z-30 border-b border-white/[0.07] bg-[#07090D]/95 backdrop-blur-xl">
        <div className="bp-treasury-header-inner mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-2 px-3 sm:min-h-20 sm:gap-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/borderpay-mark.svg" alt="BorderPay" className="h-9 w-9 shrink-0 sm:h-10 sm:w-10" />
            <div className="bp-treasury-brand-copy min-w-0"><p className="truncate text-sm font-semibold tracking-tight sm:text-base">BorderPay Africa Treasury</p><p className="hidden truncate text-xs text-zinc-500 sm:block">Master operating account</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Open treasury notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)} className={`relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white ${FOCUS}`}>
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-[#C7FF00] px-1 text-center text-[10px] font-bold leading-4 text-black">{Math.min(unreadNotifications, 99)}</span>}
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50 ${FOCUS}`} aria-label="Refresh treasury data"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
            <button type="button" onClick={onLogout} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white ${FOCUS}`}><LogOut className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
        <nav aria-label="Treasury navigation" className="mx-auto hidden max-w-[1440px] grid-cols-5 gap-2 px-6 pb-4 md:grid lg:px-10">
          {TREASURY_NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={activeView === id ? 'page' : undefined} onClick={() => navigate(id)} className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${FOCUS} ${activeView === id ? 'bg-[#C7FF00] text-black' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>)}
        </nav>
      </header>

      <main id="treasury-main" className="bp-treasury-main mx-auto w-full max-w-[1440px] space-y-5 py-5 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] sm:space-y-6 sm:py-6 md:pb-10 lg:py-10">
        {notificationsOpen && <NotificationPanel snapshot={snapshot} onClose={() => setNotificationsOpen(false)} />}
        {loading && !snapshot && <LoadingState />}
        {error && <ErrorState error={error} onRetry={() => void load()} />}

        {snapshot && !notificationsOpen && activeView === 'home' && (
          <div className="space-y-6">
            <section className="bp-treasury-card overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0D1016] p-5 sm:p-8" aria-labelledby="treasury-balance-title">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-400">Total balance</p>
                  <div id="treasury-balance-title" className="mt-3 flex items-baseline gap-3" aria-live="polite">
                    <p className="min-w-0 break-all font-mono text-[clamp(2rem,10vw,3.75rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums">{balanceVisible ? formatMoney(usdTotal, 'USD') : '••••••'}</p>
                    <span className="text-sm font-semibold text-zinc-500">USD</span>
                  </div>
                </div>
                <button type="button" onClick={() => setBalanceVisible((visible) => !visible)} aria-label={balanceVisible ? 'Hide treasury balance' : 'Show treasury balance'} aria-pressed={balanceVisible} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/[0.06] hover:text-white ${FOCUS}`}>
                  {balanceVisible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </section>

            <TreasuryActivityChart transactions={snapshot.customer_transactions} />

            <QuickActions onNavigate={navigate} />

            <section className="bp-treasury-card rounded-3xl border border-white/[0.08] bg-[#0D1016] p-4 sm:p-6" aria-labelledby="recent-activity-title">
              <div className="flex items-end justify-between gap-4"><div><h2 id="recent-activity-title" className="text-lg font-semibold">Recent activity</h2><p className="mt-1 text-sm text-zinc-500">Latest customer transactions</p></div><button type="button" onClick={() => navigate('transactions')} className={`min-h-11 text-sm font-semibold text-[#C7FF00] ${FOCUS}`}>View all</button></div>
              <TransactionCards transactions={recentTransactions} />
            </section>
          </div>
        )}

        {snapshot && !notificationsOpen && activeView === 'wallets' && <WalletsView wallets={snapshot.wallets} />}
        {snapshot && !notificationsOpen && activeView === 'receive' && <ReceiveView accounts={snapshot.virtual_accounts} />}
        {snapshot && !notificationsOpen && activeView === 'transactions' && <TransactionsView snapshot={snapshot} />}
        {snapshot && !notificationsOpen && activeView === 'send' && <SendView sendStep={sendStep} sourceSelection={sourceSelection} setSourceSelection={setSourceSelection} sendSources={sendSources} selectedSource={selectedSource} sendAmount={sendAmount} setSendAmount={setSendAmount} destinationType={destinationType} setDestinationType={setDestinationType} destinationAddress={destinationAddress} setDestinationAddress={setDestinationAddress} externalAccounts={snapshot.external_accounts} externalAccountsAvailable={snapshot.external_accounts_available} externalAccountId={externalAccountId} setExternalAccountId={setExternalAccountId} selectedExternalAccount={selectedExternalAccount} pin={pin} setPin={setPin} transferResult={transferResult} setSendStep={setSendStep} submitTransfer={submitTransfer} resetSend={resetSend} />}
      </main>

      <nav aria-label="Treasury navigation" className="bp-treasury-bottom-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/[0.08] bg-[#07090D]/95 pt-2 backdrop-blur-xl md:hidden">
        {TREASURY_NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-label={label} aria-current={activeView === id ? 'page' : undefined} onClick={() => navigate(id)} className={`flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[11px] font-semibold ${FOCUS} ${activeView === id ? 'bg-[#C7FF00]/10 text-[#C7FF00]' : 'text-zinc-400 active:bg-white/[0.06]'}`}><Icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="bp-treasury-nav-label w-full truncate text-center">{label}</span></button>)}
      </nav>
    </div>
  );
}

function NotificationPanel({ snapshot, onClose }: { snapshot: OperatorSnapshot | null; onClose: () => void }) {
  return <section aria-label="Treasury notifications" className="bp-treasury-card ml-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0D1016] p-4 shadow-2xl shadow-black/40"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><h1 className="text-lg font-semibold">Notifications</h1><p className="mt-1 truncate text-sm text-zinc-500">Latest customer and treasury activity</p></div><button type="button" aria-label="Close notifications" onClick={onClose} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.06] hover:text-white ${FOCUS}`}><X className="h-5 w-5" /></button></div><div className="mt-4 max-h-[min(65dvh,36rem)] space-y-2 overflow-y-auto overscroll-contain">{(snapshot?.notifications || []).map((notification) => <article key={notification.id} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><p className="break-words font-medium">{notification.title || title(notification.type)}</p>{!notification.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#C7FF00]" aria-label="Unread" />}</div><p className="mt-1 break-words text-sm text-zinc-400">{notification.body}</p><p className="mt-2 break-words text-xs text-zinc-500">{notification.customer_name}{notification.customer_email ? ` · ${notification.customer_email}` : ''} · {formatDate(notification.created_at)}</p></article>)}{snapshot?.platform_activity_available === false && <EmptyState text="Customer notifications are temporarily unavailable." />}{snapshot?.platform_activity_available !== false && !(snapshot?.notifications.length) && <EmptyState text="No notifications yet." />}</div></section>;
}

function WalletsView({ wallets }: { wallets: WalletRow[] }) {
  return <section aria-labelledby="wallets-title"><PageHeading eyebrow="Treasury assets" title="Wallets" description="Approved operating assets and deposit addresses. Balances are intentionally consolidated on Home." /><div className="mt-5 grid gap-4 sm:mt-6 sm:grid-cols-2 xl:grid-cols-3">{wallets.map((wallet) => <article key={`${wallet.id}:${wallet.currency}`} className="bp-treasury-card min-w-0 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-5"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><AssetMark currency={wallet.currency} /><div className="min-w-0"><h2 className="font-semibold">{wallet.currency}</h2><p className="truncate text-sm text-zinc-500">{title(wallet.chain)} network</p></div></div><StatusPill status={wallet.status} /></div><p className="mt-8 text-xs font-medium uppercase tracking-[0.15em] text-zinc-600">Deposit address</p><button type="button" onClick={() => copy(wallet.address, `${wallet.currency} address`)} className={`mt-2 flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-left ${FOCUS}`}><span className="min-w-0 truncate font-mono text-xs text-zinc-300">{wallet.address || 'Address unavailable'}</span><Copy className="h-4 w-4 shrink-0 text-zinc-500" /></button></article>)}{!wallets.length && <EmptyState text="No treasury wallets are available." />}</div></section>;
}

function ReceiveView({ accounts }: { accounts: OperatorSnapshot['virtual_accounts'] }) {
  const railOrder: Record<string, number> = { USD: 0, EUR: 1, GBP: 2 };
  return <section aria-labelledby="receive-title"><PageHeading eyebrow="Collections" title="Receiving accounts" description="Share these named account details to receive eligible business payments. New USD and GBP rails appear here automatically when enabled on the master account." /><div className="mt-5 grid gap-4 sm:mt-6 xl:grid-cols-2">{[...accounts].sort((a, b) => (railOrder[a.currency] ?? 99) - (railOrder[b.currency] ?? 99)).map((account) => <article key={account.id} className="bp-treasury-card min-w-0 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><RailMark currency={account.currency} /><div className="min-w-0"><h2 className="truncate font-semibold">{account.currency} business account</h2><p className="truncate text-sm text-zinc-500">{account.currency === 'EUR' ? 'SEPA bank transfer' : account.currency === 'GBP' ? 'Faster Payments' : account.currency === 'USD' ? 'ACH / Wire' : title(account.rail)}</p></div></div><StatusPill status={account.status} /></div><dl className="mt-6 grid min-w-0 gap-4 text-sm sm:grid-cols-2"><Detail label="Account holder" value={account.account_holder_name} /><Detail label="Bank name" value={account.bank_name} /><Detail label="IBAN" value={account.iban} copyable /><Detail label="BIC / SWIFT" value={account.bic} copyable /><Detail label="Account number" value={account.account_number} copyable /><Detail label="Routing number" value={account.routing_number} copyable /><Detail label="Bank address" value={account.bank_address} /></dl></article>)}{!accounts.length && <EmptyState text="No receiving account details are available." />}</div></section>;
}

function TransactionsView({ snapshot }: { snapshot: OperatorSnapshot }) {
  return <section aria-labelledby="transactions-title"><PageHeading eyebrow="Operations ledger" title="Customer transactions" description="Latest activity across BorderPay customers, identified by business or customer name." />{snapshot.platform_activity_available ? <TransactionLedger transactions={snapshot.customer_transactions} /> : <div className="mt-6"><EmptyState text="Customer transaction activity is temporarily unavailable. Treasury balances are unaffected." /></div>}</section>;
}

type SendViewProps = {
  sendStep: 'details' | 'pin' | 'submitting' | 'success'; sourceSelection: string; setSourceSelection: (value: string) => void;
  sendSources: Array<{ key: string; wallet_id: string; currency: string; chain: string; balance: string }>;
  selectedSource: { key: string; wallet_id: string; currency: string; chain: string; balance: string } | null;
  sendAmount: string; setSendAmount: (value: string) => void;
  destinationType: 'wallet' | 'bank'; setDestinationType: (value: 'wallet' | 'bank') => void;
  destinationAddress: string; setDestinationAddress: (value: string) => void;
  externalAccounts: TreasuryExternalAccount[]; externalAccountsAvailable: boolean; externalAccountId: string; setExternalAccountId: (value: string) => void;
  selectedExternalAccount: TreasuryExternalAccount | null;
  pin: string; setPin: (value: string) => void; transferResult: { transfer_id: string; state: string } | null;
  setSendStep: (value: 'details' | 'pin' | 'submitting' | 'success') => void; submitTransfer: () => Promise<void>; resetSend: () => void;
};

function SendView(props: SendViewProps) {
  const {
    sendStep, sourceSelection, setSourceSelection, sendSources, selectedSource,
    sendAmount, setSendAmount, destinationType, setDestinationType,
    destinationAddress, setDestinationAddress, externalAccounts, externalAccountsAvailable,
    externalAccountId, setExternalAccountId, selectedExternalAccount,
    pin, setPin, transferResult, setSendStep, submitTransfer, resetSend,
  } = props;
  const availableSources = destinationType === 'bank'
    ? sendSources.filter((source) => source.currency === 'USDC' || source.currency === 'USDT')
    : sendSources;
  const destinationReady = destinationType === 'bank'
    ? Boolean(selectedExternalAccount)
    : Boolean(destinationAddress.trim());
  const destinationLabel = destinationType === 'bank'
    ? `${selectedExternalAccount?.bank_name || selectedExternalAccount?.account_owner_name || 'bank account'} ending ${selectedExternalAccount?.last_4 || '—'}`
    : shortId(destinationAddress);
  const chooseDestinationType = (next: 'wallet' | 'bank') => {
    setDestinationType(next);
    if (next === 'bank' && selectedSource?.currency === 'EURC') setSourceSelection('');
  };

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-[#0D1016] p-5 sm:p-7" aria-labelledby="send-title">
      <PageHeading eyebrow="Money movement" title="Send from treasury" description="Send digital currency to a wallet or withdraw to a verified external bank account." />
      {sendStep === 'details' && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <fieldset className="lg:col-span-2">
            <legend className="text-sm text-zinc-300">Destination type</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#07090D] p-1.5">
              {(['wallet', 'bank'] as const).map((kind) => (
                <button key={kind} type="button" aria-pressed={destinationType === kind} onClick={() => chooseDestinationType(kind)} className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${FOCUS} ${destinationType === kind ? 'bg-[#C7FF00] text-black' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'}`}>
                  {kind === 'wallet' ? 'Digital-currency wallet' : 'External bank account'}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm text-zinc-300">Source asset
            <select value={sourceSelection} onChange={(event) => setSourceSelection(event.target.value)} className={`mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#07090D] px-3 text-base text-white ${FOCUS}`}>
              <option value="">Choose asset</option>
              {availableSources.map((source) => <option key={source.key} value={source.key}>{source.currency} · {title(source.chain)}</option>)}
            </select>
          </label>
          <label className="block text-sm text-zinc-300">Amount
            <input inputMode="decimal" value={sendAmount} onChange={(event) => setSendAmount(event.target.value)} placeholder="0.00" className={`mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#07090D] px-3 font-mono text-base text-white ${FOCUS}`} />
          </label>
          {destinationType === 'wallet' ? (
            <label className="block text-sm text-zinc-300 lg:col-span-2">Destination address {selectedSource ? `(${title(selectedSource.chain)})` : ''}
              <input value={destinationAddress} onChange={(event) => setDestinationAddress(event.target.value)} placeholder="Paste the destination wallet address" className={`mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#07090D] px-3 font-mono text-base text-white ${FOCUS}`} />
            </label>
          ) : (
            <label className="block text-sm text-zinc-300 lg:col-span-2">Verified external account
              <select value={externalAccountId} onChange={(event) => setExternalAccountId(event.target.value)} className={`mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#07090D] px-3 text-base text-white ${FOCUS}`}>
                <option value="">Choose bank account</option>
                {externalAccounts.map((account) => <option key={account.id} value={account.id}>{account.currency} · {account.bank_name || account.account_owner_name || title(account.account_type)} · ending {account.last_4 || '—'}</option>)}
              </select>
              {!externalAccounts.length && <span className="mt-2 block text-xs text-zinc-500">{externalAccountsAvailable ? 'No active external bank account is available for this treasury account.' : 'External bank accounts are temporarily unavailable. Refresh before sending.'}</span>}
            </label>
          )}
          <div className="flex justify-end lg:col-span-2">
            <button type="button" disabled={!selectedSource || !sendAmount.trim() || !destinationReady} onClick={() => setSendStep('pin')} className={`inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#C7FF00] px-5 font-semibold text-black hover:bg-[#B8EB00] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}>Review transfer <ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {(sendStep === 'pin' || sendStep === 'submitting') && <SecurityStep description={`Authorize ${sendAmount || '0'} ${selectedSource?.currency || ''} to ${destinationLabel} using the standard BorderPay transaction PIN.`} value={pin} onChange={setPin} onBack={() => setSendStep('details')} onContinue={() => void submitTransfer()} submitting={sendStep === 'submitting'} />}
      {sendStep === 'success' && transferResult && <div role="status" className="mt-6 rounded-2xl border border-[#C7FF00]/25 bg-[#C7FF00]/[0.05] p-5"><div className="flex items-center gap-2 font-semibold text-[#C7FF00]"><CheckCircle2 className="h-5 w-5" />Transfer submitted</div><p className="mt-2 text-sm text-zinc-300">Status: {title(transferResult.state)}</p><p className="mt-1 break-all font-mono text-xs text-zinc-500">{transferResult.transfer_id}</p><button type="button" onClick={resetSend} className={`mt-4 min-h-11 rounded-xl border border-white/10 px-4 text-sm font-medium hover:bg-white/[0.06] ${FOCUS}`}>New transfer</button></div>}
    </section>
  );
}

function PageHeading({ eyebrow, title: heading, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C7FF00] sm:text-xs">{eyebrow}</p><h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-4xl">{heading}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p></header>;
}

function AssetMark({ currency }: { currency: string }) {
  const symbol = currency === 'USDT' ? '₮' : currency === 'EURC' ? '€' : '$';
  const colors = currency === 'USDT' ? 'bg-[#26A17B] text-white' : currency === 'EURC' ? 'bg-[#1A4BD6] text-white' : 'bg-[#2775CA] text-white';
  return <span aria-label={`${currency} asset`} className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold ring-2 ring-white/10 ${colors}`}>{symbol}</span>;
}

function RailMark({ currency }: { currency: string }) {
  const region = currency === 'USD' ? 'US' : currency === 'EUR' ? 'EU' : currency === 'GBP' ? 'GB' : currency.slice(0, 2);
  return <span aria-label={`${region} payment rail`} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs font-bold tracking-wider text-white">{region}</span>;
}

function QuickActions({ onNavigate }: { onNavigate: (view: TreasuryView) => void }) {
  const actions = [
    { view: 'wallets' as const, label: 'Wallet', detail: 'Asset details', icon: WalletCards },
    { view: 'receive' as const, label: 'Accounts', detail: 'Receiving rails', icon: Landmark },
    { view: 'transactions' as const, label: 'Transactions', detail: 'Operations ledger', icon: ReceiptText },
    { view: 'send' as const, label: 'Send', detail: 'Move funds', icon: Send },
  ];
  return <section aria-labelledby="quick-actions-title"><h2 id="quick-actions-title" className="text-lg font-semibold">Quick actions</h2><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{actions.map(({ view, label, detail, icon: Icon }) => <button key={view} type="button" onClick={() => onNavigate(view)} className={`bp-treasury-card group min-h-24 min-w-0 rounded-2xl border border-white/[0.08] bg-[#0D1016] p-3 text-left transition-colors hover:border-[#C7FF00]/30 hover:bg-white/[0.04] sm:min-h-28 sm:p-4 ${FOCUS}`}><div className="flex items-start justify-between"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-[#C7FF00]"><Icon className="h-5 w-5" aria-hidden="true" /></span><ArrowRight className="h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-300" aria-hidden="true" /></div><p className="mt-3 truncate font-semibold sm:mt-4">{label}</p><p className="mt-1 hidden truncate text-xs text-zinc-500 min-[380px]:block">{detail}</p></button>)}</div></section>;
}

function transactionUsdAmount(transaction: CustomerTransaction): number | null {
  const value = String(transaction.currency || '').toUpperCase();
  if (!['USD', 'USDC', 'USDT'].includes(value)) return null;
  const amount = Number(transaction.amount);
  return Number.isFinite(amount) ? amount : null;
}

function TreasuryActivityChart({ transactions }: { transactions: CustomerTransaction[] }) {
  const ranges = [
    { id: '1M', days: 30 },
    { id: '3M', days: 90 },
    { id: '6M', days: 180 },
    { id: '1Y', days: 365 },
  ] as const;
  const [range, setRange] = useState<(typeof ranges)[number]['id']>('1M');
  const dayCount = ranges.find((option) => option.id === range)?.days || 30;
  const points = useMemo(() => {
    const completed = new Set(['completed', 'payment_processed', 'approved', 'settlement_complete']);
    const days = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (dayCount - 1 - index));
      return { key: date.toISOString().slice(0, 10), date, value: 0 };
    });
    const byDay = new Map(days.map((day) => [day.key, day]));
    for (const transaction of transactions) {
      const usdAmount = transactionUsdAmount(transaction);
      if (!completed.has(transaction.status) || usdAmount === null) continue;
      const occurredAt = new Date(transaction.created_at);
      if (Number.isNaN(occurredAt.getTime())) continue;
      const key = occurredAt.toISOString().slice(0, 10);
      const day = byDay.get(key);
      if (day) day.value += usdAmount;
    }
    return days;
  }, [dayCount, transactions]);
  const max = Math.max(...points.map((point) => point.value), 1);
  const coordinates = points.map((point, index) => ({ x: (index / Math.max(points.length - 1, 1)) * 760, y: 190 - (point.value / max) * 160, ...point }));
  const line = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L 760 200 L 0 200 Z`;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const summary = `Completed USD transaction volume for the selected ${range} period is ${formatMoney(total, 'USD')}.`;

  return <section className="bp-treasury-card min-w-0 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-4 sm:p-6" aria-labelledby="treasury-chart-title"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C7FF00]">Treasury dashboard</p><h2 id="treasury-chart-title" className="mt-1 text-base font-semibold">Transaction volume</h2><p className="mt-1 text-xs text-zinc-500">Completed activity in USD</p></div><div className="grid w-full grid-cols-4 rounded-xl border border-white/[0.08] bg-black/20 p-1 sm:w-auto" aria-label="Chart period">{ranges.map((option) => <button key={option.id} type="button" aria-pressed={range === option.id} onClick={() => setRange(option.id)} className={`min-h-10 min-w-0 rounded-lg px-2 text-xs font-semibold sm:px-3 ${FOCUS} ${range === option.id ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}>{option.id}</button>)}</div></div><div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1"><p className="min-w-0 break-all font-mono text-lg font-semibold tabular-nums sm:text-xl">{formatMoney(total, 'USD')}</p><span className="text-[11px] text-zinc-500">completed volume</span></div><div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20 p-2 sm:p-3"><svg viewBox="0 0 760 220" role="img" aria-label={summary} className="aspect-[19/7] min-h-36 w-full max-h-56" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="treasury-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C7FF00" stopOpacity="0.28" /><stop offset="100%" stopColor="#C7FF00" stopOpacity="0" /></linearGradient></defs>{[40, 80, 120, 160, 200].map((y) => <line key={y} x1="0" x2="760" y1={y} y2={y} stroke="rgba(255,255,255,.06)" strokeWidth="1" />)}<path d={area} fill="url(#treasury-area)" /><path d={line} fill="none" stroke="#C7FF00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{coordinates.filter((_, index) => index === 0 || index === coordinates.length - 1 || _.value === max).map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="4" fill="#07090D" stroke="#C7FF00" strokeWidth="3"><title>{`${point.date.toLocaleDateString()}: ${formatMoney(point.value, 'USD')}`}</title></circle>)}</svg><div className="flex justify-between text-[11px] text-zinc-600"><span>{points[0]?.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span><span>{points[points.length - 1]?.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div></div><p className="sr-only">{summary}</p></section>;
}

function StatusPill({ status }: { status: string }) {
  const active = ['active', 'completed', 'payment_processed', 'approved'].includes(status.toLowerCase());
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${active ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-zinc-400'}`}>{title(status)}</span>;
}

function TransactionCards({ transactions }: { transactions: CustomerTransaction[] }) {
  return <div className="mt-4 divide-y divide-white/[0.07]">{transactions.map((transaction) => <article key={transaction.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium">{transaction.customer_name}</p><p className="truncate text-sm text-zinc-500">{transaction.customer_email || transaction.description || title(transaction.type)}</p></div><div className="flex items-center justify-between gap-6 sm:text-right"><div><p className="font-mono font-semibold tabular-nums">{formatMoney(transaction.amount, transaction.currency || 'USD')}</p><p className="text-xs text-zinc-500">{formatDate(transaction.created_at)}</p></div><StatusPill status={transaction.status} /></div></article>)}{!transactions.length && <EmptyState text="No customer transactions yet." />}</div>;
}

function TransactionLedger({ transactions }: { transactions: CustomerTransaction[] }) {
  return <div className="mt-6 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-3 sm:p-5"><div className="space-y-3 md:hidden">{transactions.map((transaction) => <article key={transaction.id} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{transaction.customer_name}</p><p className="truncate text-sm text-zinc-500">{transaction.customer_email}</p></div><StatusPill status={transaction.status} /></div><p className="mt-5 font-mono text-xl font-semibold">{formatMoney(transaction.amount, transaction.currency || 'USD')}</p><div className="mt-3 flex justify-between gap-3 text-xs text-zinc-500"><span>{title(transaction.type)}</span><span>{formatDate(transaction.created_at)}</span></div></article>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[860px] border-collapse text-left text-sm"><thead className="text-xs uppercase tracking-wider text-zinc-600"><tr className="border-b border-white/[0.08]"><th className="px-3 py-3 font-medium">Customer</th><th className="px-3 py-3 font-medium">Transaction</th><th className="px-3 py-3 font-medium">Amount</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Reference</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id} className="border-b border-white/[0.06] last:border-0"><td className="px-3 py-4"><p className="font-medium">{transaction.customer_name}</p><p className="text-xs text-zinc-500">{transaction.customer_email}</p></td><td className="px-3 py-4">{title(transaction.type)}<p className="text-xs text-zinc-500">{transaction.description}</p></td><td className="px-3 py-4 font-mono font-semibold tabular-nums">{formatMoney(transaction.amount, transaction.currency || 'USD')}</td><td className="px-3 py-4"><StatusPill status={transaction.status} /></td><td className="px-3 py-4 text-zinc-400">{formatDate(transaction.created_at)}</td><td className="px-3 py-4"><button type="button" onClick={() => copy(transaction.reference || transaction.id, 'Reference')} className={`inline-flex min-h-11 items-center gap-2 font-mono text-xs text-zinc-300 ${FOCUS}`}>{shortId(transaction.reference || transaction.id)}<Copy className="h-3.5 w-3.5" /></button></td></tr>)}</tbody></table></div>{!transactions.length && <EmptyState text="No customer transactions yet." />}</div>;
}

function Detail({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  return <div><dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1 flex min-h-8 items-center gap-2 break-all text-zinc-200"><span>{value || '—'}</span>{copyable && value && <button type="button" onClick={() => copy(value, label)} aria-label={`Copy ${label}`} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-white/[0.06] ${FOCUS}`}><Copy className="h-3.5 w-3.5" /></button>}</dd></div>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-400">{text}</p>;
}

function LoadingState() {
  return <div className="space-y-4" aria-label="Loading treasury data"><div className="h-64 animate-pulse rounded-3xl bg-white/[0.04]" /><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />)}</div></div>;
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <section role="alert" className="rounded-3xl border border-red-500/30 bg-red-500/[0.08] p-5"><h1 className="font-semibold text-red-200">Treasury data unavailable</h1><p className="mt-2 text-sm text-red-100/80">{error}</p><button type="button" onClick={onRetry} className={`mt-4 min-h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black ${FOCUS}`}>Try again</button></section>;
}

function SecurityStep({ description, value, onChange, onBack, onContinue, submitting = false }: { description: string; value: string; onChange: (value: string) => void; onBack: () => void; onContinue: () => void; submitting?: boolean }) {
  return <div className="mt-6 max-w-lg rounded-2xl border border-white/[0.08] bg-black/20 p-5"><h2 className="font-semibold">Transaction PIN</h2><p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p><label className="mt-4 block text-sm text-zinc-300">PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} className={`mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#07090D] px-3 text-center font-mono text-xl tracking-[0.35em] text-white ${FOCUS}`} /></label><div className="mt-4 flex justify-between gap-3"><button type="button" disabled={submitting} onClick={onBack} className={`min-h-11 rounded-xl border border-white/10 px-4 text-sm font-medium hover:bg-white/[0.06] disabled:opacity-50 ${FOCUS}`}>Back</button><button type="button" disabled={value.length < 4 || submitting} onClick={onContinue} className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#C7FF00] px-5 text-sm font-semibold text-black hover:bg-[#B8EB00] disabled:opacity-40 ${FOCUS}`}>{submitting && <RefreshCw className="h-4 w-4 animate-spin" />}{submitting ? 'Submitting' : 'Confirm transfer'}</button></div></div>;
}
