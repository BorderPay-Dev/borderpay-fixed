import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight, ArrowDownLeft, Search, ShieldCheck, ArrowRight, Bell, CheckCircle2, Copy, Eye, EyeOff, Home,
  Landmark, LogOut, ReceiptText, RefreshCw, Send, WalletCards, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { treasuryAPI } from './treasury/api';
import { walletBalance, formatSortCode, isPending } from './treasury/values';
import './treasury/treasury.css';

type WalletRow = {
  id: string;
  currency: string;
  chain: string;
  address: string;
  status: string;
  balance_available: boolean;
  balances: Array<{ currency: string; chain: string; balance: string }>;
};

type BridgeTransfer = {
  id: string;
  state: string;
  activity_kind?: 'transfer' | 'virtual_account';
  activity_type?: string;
  reference?: string;
  source: { currency: string; payment_rail: string; amount: string };
  destination: { currency: string; payment_rail: string; amount: string };
  created_at: string;
  updated_at: string;
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
  source: 'bridge_production_live';
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
    sort_code?: string;
    iban: string;
    bic: string;
    created_at: string;
  }>;
  external_accounts: TreasuryExternalAccount[];
  external_accounts_available: boolean;
  transactions: BridgeTransfer[];
  transfers_available: boolean;
  virtual_account_history_available?: boolean;
  wallets_available: boolean;
  virtual_accounts_available: boolean;
  profile_available: boolean;
  refreshed_at: string;
};

type TreasuryView = 'home' | 'wallets' | 'receive' | 'transactions' | 'send';

const TREASURY_NAV = [
  { id: 'home', label: 'Overview', icon: Home },
  { id: 'wallets', label: 'Balances', icon: WalletCards },
  { id: 'receive', label: 'Accounts', icon: Landmark },
  { id: 'transactions', label: 'Activity', icon: ReceiptText },
  { id: 'send', label: 'Transfer', icon: Send },
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
  if (value === '' || !Number.isFinite(number)) return `— ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
  } catch {
    return `${new Intl.NumberFormat(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(number)} ${currency}`;
  }
}

function copy(value: string, label: string) {
  if (!value) return;
  void navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error(`Could not copy ${label.toLowerCase()}`),
  );
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

  const reading = useRef(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const load = useCallback(async (_silent = false) => {
    if (reading.current) return;
    reading.current = true;
    setLoading(true);
    try {
      const response = await treasuryAPI.getSnapshot<OperatorSnapshot>();
      if (!mounted.current) return;
      if (!response.success || !response.data || response.data.source !== 'bridge_production_live') {
        setError(response.error || 'Treasury data is temporarily unavailable.');
        return;
      }
      setSnapshot(response.data);
      setError('');
    } catch { if (mounted.current) setError('Treasury refresh failed. Try again.'); }
    finally { reading.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

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
  const usdRows = assetRows.filter(row => ['USDC', 'USDT'].includes(row.currency));
  const usdTotal = snapshot?.wallets_available && usdRows.length && usdRows.every(row => row.balance !== null) ? usdRows.reduce((sum, row) => sum + row.balance!, 0) : null;
  const pendingTransfers = snapshot?.transactions.filter((transaction) => isPending(transaction.state)).length || 0;
  const recentTransactions = snapshot?.transactions.slice(0, 6) || [];
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
    if (!selectedSource || submitting.current) return;
    if (destinationType === 'bank' && !selectedExternalAccount) {
      toast.error('Choose an active external bank account.');
      return;
    }
    submitting.current = true;
    setSendStep('submitting');
    const response = await treasuryAPI.send({
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
    submitting.current = false;
    setPin('');
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
    <div className="bp-treasury-shell">
      <a href="#treasury-main" className="treasury-skip">Skip to treasury content</a>
      <aside className="treasury-sidebar">
        <div className="treasury-brand"><img src="/logo-color.png" alt="BorderPay" /><div>BorderPay<span>TREASURY</span></div></div>
        <div className="treasury-workspace"><span className="treasury-avatar">BA</span><div>Operating master<small>BorderPay Africa</small></div><ShieldCheck size={16} /></div>
        <p className="treasury-nav-caption">WORKSPACE</p>
        <nav aria-label="Treasury navigation">{TREASURY_NAV.map(({id, label, icon: Icon}) => <button key={id} aria-current={activeView === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={19}/><span>{label}</span>{activeView === id && <span className="treasury-nav-dot"/>}</button>)}</nav>
        <div className="treasury-sidebar-footer"><ShieldCheck size={18}/><p>Private workspace<small>founder@borderpayafrica.com</small></p></div>
        <button className="treasury-signout" onClick={onLogout}><LogOut size={18}/>Sign out</button>
      </aside>
      <div className="treasury-workarea">
        <header className="treasury-topbar"><div><span className="treasury-breadcrumb">Treasury /</span> {TREASURY_NAV.find(item => item.id === activeView)?.label}</div><div className="treasury-top-actions"><span className="treasury-private"><ShieldCheck size={14}/> Founder access</span><button aria-label="Open treasury notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(open => !open)}><Bell size={19}/>{pendingTransfers > 0 && <i>{pendingTransfers}</i>}</button><button aria-label="Sign out" className="treasury-mobile-signout" onClick={onLogout}><LogOut size={18}/></button><span className="treasury-avatar">BA</span></div></header>
        <main id="treasury-main" className="bp-treasury-main" tabIndex={-1}>
          <div className="treasury-page-top"><div><p className="treasury-eyebrow">BORDERPAY AFRICA · OPERATING MASTER</p><h1>{activeView === 'home' ? 'Treasury overview' : activeView === 'wallets' ? 'Asset balances' : activeView === 'receive' ? 'Receiving accounts' : activeView === 'transactions' ? 'Account activity' : 'Move money'}</h1><p className="treasury-subtitle">{snapshot?.account.name || 'Your private financial workspace'}</p></div><button className="treasury-button treasury-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>{loading ? 'Refreshing' : 'Refresh data'}</button></div>
          <div className="treasury-freshness" role="status"><span className={error ? 'treasury-dot stale' : snapshot ? 'treasury-dot' : 'treasury-dot stale'}/>{error ? 'Refresh interrupted · last available snapshot' : snapshot ? `Last refreshed ${formatDate(snapshot.refreshed_at)}` : 'Connecting to your treasury'}{snapshot && <span>Source: Bridge</span>}</div>
          {error && <ErrorState error={error} onRetry={() => void load()} />}
          {loading && !snapshot && <LoadingState />}
          {notificationsOpen && <NotificationPanel snapshot={snapshot} onClose={() => setNotificationsOpen(false)} />}
          {snapshot && !notificationsOpen && activeView === 'home' && <>
            <div className="treasury-overview-grid">
              <section className="treasury-liquidity" aria-label="Treasury liquidity"><div className="treasury-section-label">USD STABLECOINS<button aria-label={balanceVisible ? 'Hide treasury balance' : 'Show treasury balance'} aria-pressed={balanceVisible} onClick={() => setBalanceVisible(value => !value)}>{balanceVisible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div><p className="treasury-total">{balanceVisible ? usdTotal === null ? 'Unavailable' : new Intl.NumberFormat(undefined, {maximumFractionDigits: 2, minimumFractionDigits: 2}).format(usdTotal) : '••••••'}<span>USDC + USDT</span></p><p className="treasury-balance-note">Token units held · EURC shown separately below</p><div className="treasury-hero-actions"><button className="treasury-button treasury-primary" onClick={() => navigate('send')}>Make a transfer<ArrowUpRight size={17}/></button><button className="treasury-button treasury-secondary" onClick={() => navigate('receive')}><ArrowDownLeft size={17}/>Receive funds</button></div></section>
              <section className="treasury-position"><p className="treasury-eyebrow">OPERATIONAL POSITION</p><div><span>Receiving accounts</span><strong>{snapshot.virtual_accounts_available ? snapshot.virtual_accounts.length : '—'}</strong></div><div><span>Transfers in progress</span><strong>{snapshot.transfers_available ? pendingTransfers : '—'}</strong></div><div><span>Saved bank destinations</span><strong>{snapshot.external_accounts_available ? snapshot.external_accounts.length : '—'}</strong></div><small>Counts reflect the latest available snapshot.</small></section>
            </div>
            <div className="treasury-assets">{assetRows.map(wallet => <button key={`${wallet.id}:${wallet.currency}`} className="treasury-asset" onClick={() => navigate('wallets')}><div><AssetMark currency={wallet.currency}/><span>{wallet.currency}<small>{title(wallet.chain)}</small></span><ArrowUpRight size={17}/></div><strong>{balanceVisible ? wallet.balance === null ? 'Unavailable' : formatMoney(wallet.balance, wallet.currency) : '••••••'}</strong><small>{wallet.balance === null ? 'Balance could not be read' : 'Available balance'}</small></button>)}</div>
            {!snapshot.wallets_available && <EmptyState text="Wallet balances are temporarily unavailable. Refresh to try again."/>}
            <div className="treasury-analysis-grid"><div>{snapshot.transfers_available ? <TreasuryActivityChart transactions={snapshot.transactions}/> : <EmptyState text="Transaction volume is temporarily unavailable."/>}</div><section className="treasury-rail-summary"><div className="treasury-section-heading"><h2>Receiving rails</h2><button onClick={() => navigate('receive')}>Details <ArrowRight size={14}/></button></div>{snapshot.virtual_accounts.map(account => <button key={account.id} onClick={() => navigate('receive')}><RailMark currency={account.currency}/><span>{account.currency}<small>{title(account.rail)}</small></span><StatusPill status={account.status}/></button>)}{!snapshot.virtual_accounts.length && <EmptyState text="No receiving account data available."/>}</section></div>
            <section className="treasury-panel"><div className="treasury-section-heading"><div><h2>Recent activity</h2><p>Latest transfers and account deposits</p></div><button onClick={() => navigate('transactions')}>View activity <ArrowRight size={15}/></button></div><TransferCards transactions={recentTransactions} available={snapshot.transfers_available}/></section>
          </>}
          {snapshot && !notificationsOpen && activeView === 'wallets' && <WalletsView wallets={snapshot.wallets}/>}
          {snapshot && !notificationsOpen && activeView === 'receive' && <ReceiveView accounts={snapshot.virtual_accounts} available={snapshot.virtual_accounts_available}/>}
          {snapshot && !notificationsOpen && activeView === 'transactions' && <TransactionsView snapshot={snapshot}/>}
        {snapshot && !notificationsOpen && activeView === 'send' && <SendView sendStep={sendStep} sourceSelection={sourceSelection} setSourceSelection={setSourceSelection} sendSources={sendSources} selectedSource={selectedSource} sendAmount={sendAmount} setSendAmount={setSendAmount} destinationType={destinationType} setDestinationType={setDestinationType} destinationAddress={destinationAddress} setDestinationAddress={setDestinationAddress} externalAccounts={snapshot.external_accounts} externalAccountsAvailable={snapshot.external_accounts_available} externalAccountId={externalAccountId} setExternalAccountId={setExternalAccountId} selectedExternalAccount={selectedExternalAccount} pin={pin} setPin={setPin} transferResult={transferResult} setSendStep={setSendStep} submitTransfer={submitTransfer} resetSend={resetSend} />}
          <footer className="treasury-footer"><span>BorderPay Africa Treasury</span><span>Operating master account · Private access</span></footer>
        </main>
      </div>
      <nav className="bp-treasury-bottom-nav" aria-label="Mobile treasury navigation">{TREASURY_NAV.map(({id, label, icon: Icon}) => <button key={id} aria-label={label} aria-current={activeView === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
    </div>
  );
}

function NotificationPanel({ snapshot, onClose }: { snapshot: OperatorSnapshot | null; onClose: () => void }) {
  const pending = (snapshot?.transactions || []).filter((transaction) => isPending(transaction.state));
  return <section aria-label="Treasury notifications" className="bp-treasury-card ml-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0D1016] p-4 shadow-2xl shadow-black/40"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><h1 className="text-lg font-semibold">Treasury updates</h1><p className="mt-1 truncate text-sm text-zinc-500">Transfers requiring attention</p></div><button type="button" aria-label="Close notifications" onClick={onClose} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.06] hover:text-white ${FOCUS}`}><X className="h-5 w-5" /></button></div><div className="mt-4 max-h-[min(65dvh,36rem)] space-y-2 overflow-y-auto overscroll-contain">{pending.map((transaction) => <article key={transaction.id} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><p className="break-words font-medium">{title(transaction.state || 'Transfer update')}</p><StatusPill status={transaction.state} /></div><p className="mt-2 break-words text-sm text-zinc-400">{title(transaction.source.payment_rail)} → {title(transaction.destination.payment_rail)}</p><p className="mt-2 break-words font-mono text-xs text-zinc-500">{shortId(transaction.id)} · {formatDate(transaction.updated_at || transaction.created_at)}</p></article>)}{snapshot?.transfers_available === false && <EmptyState text="Live transfer updates are temporarily unavailable." />}{snapshot?.transfers_available !== false && !pending.length && <EmptyState text="No transfers require attention." />}</div></section>;
}

function WalletsView({ wallets }: { wallets: WalletRow[] }) {
  return <section aria-labelledby="wallets-title"><PageHeading eyebrow="Treasury assets" title="Wallets" description="Live balances by asset. Copy the matching network address to receive funds." /><div className="mt-5 grid gap-4 sm:mt-6 sm:grid-cols-2 xl:grid-cols-3">{wallets.map((wallet) => <article key={`${wallet.id}:${wallet.currency}`} className="bp-treasury-card min-w-0 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-5"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><AssetMark currency={wallet.currency} /><div className="min-w-0"><h2 className="font-semibold">{wallet.currency}</h2><p className="truncate text-sm text-zinc-500">{title(wallet.chain)} network</p></div></div><StatusPill status={wallet.status} /></div><p className="treasury-wallet-amount">{walletBalance(wallet) === null ? 'Unavailable' : formatMoney(walletBalance(wallet)!, wallet.currency)}</p><p className="mt-8 text-xs font-medium uppercase tracking-[0.15em] text-zinc-600">Deposit address</p><button type="button" onClick={() => copy(wallet.address, `${wallet.currency} address`)} className={`mt-2 flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-left ${FOCUS}`}><span className="min-w-0 truncate font-mono text-xs text-zinc-300">{wallet.address || 'Address unavailable'}</span><Copy className="h-4 w-4 shrink-0 text-zinc-500" /></button></article>)}{!wallets.length && <EmptyState text="No treasury wallets are available." />}</div></section>;
}

function ReceiveView({ accounts, available }: { accounts: OperatorSnapshot['virtual_accounts']; available: boolean }) {
  const railOrder: Record<string, number> = { USD: 0, EUR: 1, GBP: 2 };
  return <section aria-labelledby="receive-title"><PageHeading eyebrow="Collections" title="Receiving accounts" description="Use the exact beneficiary and bank details below when making a deposit." /><div className="mt-5 grid gap-4 sm:mt-6 xl:grid-cols-2">{[...accounts].sort((a, b) => (railOrder[a.currency] ?? 99) - (railOrder[b.currency] ?? 99)).map((account) => <article key={account.id} className="bp-treasury-card min-w-0 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><RailMark currency={account.currency} /><div className="min-w-0"><h2 className="truncate font-semibold">{account.currency} business account</h2><p className="truncate text-sm text-zinc-500">{account.currency === 'EUR' ? 'SEPA' : account.currency === 'GBP' ? 'Faster Payments' : account.currency === 'USD' ? title(account.rail || 'ACH / Wire') : title(account.rail)}</p></div></div><StatusPill status={account.status} /></div><dl className="mt-6 grid min-w-0 gap-4 text-sm sm:grid-cols-2"><Detail label="Account holder" value={account.account_holder_name} /><Detail label="Bank name" value={account.bank_name} />{account.currency === 'EUR' && <><Detail label="IBAN" value={account.iban} copyable /><Detail label="BIC / SWIFT" value={account.bic} copyable /></>}{account.currency !== 'EUR' && <><Detail label="Account number" value={account.account_number} copyable /><Detail label={account.currency === 'USD' ? 'Routing number' : 'Sort code'} value={account.currency === 'GBP' ? formatSortCode(account.sort_code || account.routing_number) : account.routing_number} copyable /></>}<Detail label="Bank address" value={account.bank_address} /></dl></article>)}{!accounts.length && <EmptyState text={available ? 'No live receiving accounts are enabled for this treasury yet.' : 'Receiving account data is temporarily unavailable. Other treasury sections remain available.'} />}</div></section>;
}

function TransactionsView({ snapshot }: { snapshot: OperatorSnapshot }) {
  return <section aria-labelledby="transactions-title"><PageHeading eyebrow="Operations ledger" title="Transactions" description="Live transfers for the BorderPay Africa master operating account only." />{snapshot.transfers_available ? <BridgeTransferLedger transactions={snapshot.transactions} /> : <div className="mt-6"><EmptyState text="Live transfer data is temporarily unavailable. Wallets and receiving accounts remain accessible." /></div>}</section>;
}

function BridgeTransferLedger({ transactions }: { transactions: OperatorSnapshot['transactions'] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = transactions.filter(row => (!query || `${row.id} ${row.reference || ''} ${row.source.currency} ${row.destination.currency} ${row.source.payment_rail} ${row.destination.payment_rail}`.toLowerCase().includes(query.toLowerCase())) && (status === 'all' || (status === 'pending' ? isPending(row.state) : status === 'completed' ? ['completed', 'payment_processed', 'settlement_complete'].includes(row.state) : ['failed', 'refunded', 'returned', 'canceled', 'cancelled'].includes(row.state))));
  return <section className="treasury-panel mt-6"><div className="treasury-ledger-filters"><label><Search size={17}/><input aria-label="Search treasury activity" placeholder="Search reference, asset or rail" value={query} onChange={event => setQuery(event.target.value)}/></label><select aria-label="Filter activity status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">In progress</option><option value="completed">Completed</option><option value="failed">Failed or returned</option></select><span>{filtered.length} records</span></div><div className="treasury-table-scroll"><table className="treasury-ledger"><thead><tr><th>Transfer / reference</th><th>Source amount</th><th>Destination amount</th><th>Status</th><th>Last update</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><strong>{title(row.source.payment_rail)} → {title(row.destination.payment_rail)}</strong><button onClick={() => copy(row.id, 'Transfer reference')} aria-label={`Copy transfer ${row.id}`}>{shortId(row.id)} <Copy size={12}/></button></td><td>{formatMoney(row.source.amount, row.source.currency)}</td><td>{formatMoney(row.destination.amount, row.destination.currency)}</td><td><StatusPill status={row.state}/></td><td>{formatDate(row.updated_at || row.created_at)}</td></tr>)}</tbody></table></div>{!filtered.length && <EmptyState text={transactions.length ? 'No activity matches these filters.' : 'No master-account activity returned.'}/>}<p className="mt-4 text-xs text-zinc-500">Latest returned records. Source and destination amounts retain their original currencies.</p></section>;
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
                  {kind === 'wallet' ? 'External wallet address' : 'External bank account'}
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
          {selectedSource && <p className="text-sm text-zinc-400 lg:col-span-2">Available: {formatMoney(selectedSource.balance, selectedSource.currency)}{Number(sendAmount) > Number(selectedSource.balance) && <span role="alert" className="text-red-300"> · Amount exceeds available balance</span>}</p>}
          <div className="flex justify-end lg:col-span-2">
            <button type="button" disabled={!selectedSource || !Number.isFinite(Number(sendAmount)) || Number(sendAmount) <= 0 || Number(sendAmount) > Number(selectedSource.balance) || !destinationReady} onClick={() => setSendStep('pin')} className={`inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#C7FF00] px-5 font-semibold text-black hover:bg-[#B8EB00] disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}>Review transfer <ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {(sendStep === 'pin' || sendStep === 'submitting') && <SecurityStep description={`Authorize ${sendAmount || '0'} ${selectedSource?.currency || ''} to ${destinationLabel} using the standard BorderPay transaction PIN.`} value={pin} onChange={setPin} onBack={() => setSendStep('details')} onContinue={() => void submitTransfer()} submitting={sendStep === 'submitting'} />}
      {sendStep === 'success' && transferResult && <div role="status" className="mt-6 rounded-2xl border border-[#C7FF00]/25 bg-[#C7FF00]/[0.05] p-5"><div className="flex items-center gap-2 font-semibold text-[#C7FF00]"><CheckCircle2 className="h-5 w-5" />Transfer submitted</div><p className="mt-2 text-sm text-zinc-300">Status: {title(transferResult.state)}</p><p className="mt-1 break-all font-mono text-xs text-zinc-500">{transferResult.transfer_id}</p><button type="button" onClick={resetSend} className={`mt-4 min-h-11 rounded-xl border border-white/10 px-4 text-sm font-medium hover:bg-white/[0.06] ${FOCUS}`}>New transfer</button></div>}
    </section>
  );
}

function PageHeading({ eyebrow, title: heading, description }: { eyebrow: string; title: string; description: string }) {
  return <header aria-label={`${eyebrow}: ${heading}`} className="min-w-0"><p className="max-w-2xl text-sm leading-6 text-zinc-400">{description}</p></header>;
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

function transactionUsdAmount(transaction: BridgeTransfer): number | null {
  const candidates = [transaction.destination, transaction.source];
  for (const candidate of candidates) {
    if (!['USD', 'USDC', 'USDT'].includes(String(candidate.currency || '').toUpperCase())) continue;
    const value = Number(candidate.amount);
    if (candidate.amount !== '' && Number.isFinite(value)) return value;
  }
  return null;
}

function TreasuryActivityChart({ transactions }: { transactions: BridgeTransfer[] }) {
  const ranges = [
    { id: '1M', days: 30 },
    { id: '3M', days: 90 },
    { id: '6M', days: 180 },
    { id: '1Y', days: 365 },
  ] as const;
  const [range, setRange] = useState<(typeof ranges)[number]['id']>('1M');
  const dayCount = ranges.find((option) => option.id === range)?.days || 30;
  const points = useMemo(() => {
    const completed = new Set(['completed', 'payment_processed', 'settlement_complete']);
    const days = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (dayCount - 1 - index));
      return { key: date.toISOString().slice(0, 10), date, value: 0 };
    });
    const byDay = new Map(days.map((day) => [day.key, day]));
    for (const transaction of transactions) {
      const usdAmount = transactionUsdAmount(transaction);
      if (!completed.has(transaction.state) || usdAmount === null) continue;
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

  return <section className="bp-treasury-card min-w-0 rounded-3xl border border-white/[0.08] bg-[#0D1016] p-4 sm:p-6" aria-labelledby="treasury-chart-title"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C7FF00]">Treasury dashboard</p><h2 id="treasury-chart-title" className="mt-1 text-base font-semibold">Transaction volume</h2><p className="mt-1 text-xs text-zinc-500">USD-denominated legs in the returned activity</p></div><div className="grid w-full grid-cols-4 rounded-xl border border-white/[0.08] bg-black/20 p-1 sm:w-auto" aria-label="Chart period">{ranges.map((option) => <button key={option.id} type="button" aria-pressed={range === option.id} onClick={() => setRange(option.id)} className={`min-h-10 min-w-0 rounded-lg px-2 text-xs font-semibold sm:px-3 ${FOCUS} ${range === option.id ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}>{option.id}</button>)}</div></div><div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1"><p className="min-w-0 break-all font-mono text-lg font-semibold tabular-nums sm:text-xl">{formatMoney(total, 'USD')}</p><span className="text-[11px] text-zinc-500">completed volume · returned records only</span></div><div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20 p-2 sm:p-3"><svg viewBox="0 0 760 220" role="img" aria-label={summary} className="aspect-[19/7] min-h-36 w-full max-h-56" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="treasury-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C7FF00" stopOpacity="0.28" /><stop offset="100%" stopColor="#C7FF00" stopOpacity="0" /></linearGradient></defs>{[40, 80, 120, 160, 200].map((y) => <line key={y} x1="0" x2="760" y1={y} y2={y} stroke="rgba(255,255,255,.06)" strokeWidth="1" />)}<path d={area} fill="url(#treasury-area)" /><path d={line} fill="none" stroke="#C7FF00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{coordinates.filter((_, index) => index === 0 || index === coordinates.length - 1 || _.value === max).map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="4" fill="#07090D" stroke="#C7FF00" strokeWidth="3"><title>{`${point.date.toLocaleDateString()}: ${formatMoney(point.value, 'USD')}`}</title></circle>)}</svg><div className="flex justify-between text-[11px] text-zinc-600"><span>{points[0]?.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span><span>{points[points.length - 1]?.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div></div><p className="sr-only">{summary}</p></section>;
}

function StatusPill({ status }: { status: string }) {
  const active = ['active', 'completed', 'payment_processed', 'approved'].includes(status.toLowerCase());
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${active ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-zinc-400'}`}>{title(status)}</span>;
}

function TransferCards({ transactions, available }: { transactions: BridgeTransfer[]; available: boolean }) {
  return <div className="mt-4 divide-y divide-white/[0.07]">{transactions.map((transaction) => <article key={transaction.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium">{title(transaction.source.payment_rail || 'Treasury')} → {title(transaction.destination.payment_rail || 'Destination')}</p><p className="truncate font-mono text-xs text-zinc-500">{transaction.id}</p></div><div className="flex items-center justify-between gap-6 sm:text-right"><div><p className="font-mono font-semibold tabular-nums">{formatMoney(transaction.source.amount, transaction.source.currency)}</p><p className="text-xs text-zinc-500">{formatDate(transaction.updated_at || transaction.created_at)}</p></div><StatusPill status={transaction.state} /></div></article>)}{!transactions.length && <EmptyState text={available ? 'No master-account transfers yet.' : 'Live transfer activity is temporarily unavailable.'} />}</div>;
}

function Detail({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  return <div><dt className="text-xs uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1 flex min-h-8 items-center gap-2 break-all text-zinc-200"><span>{value || '—'}</span>{copyable && value && <button type="button" onClick={() => copy(value, label)} aria-label={`Copy ${label}`} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/[0.06] ${FOCUS}`}><Copy className="h-3.5 w-3.5" /></button>}</dd></div>;
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
