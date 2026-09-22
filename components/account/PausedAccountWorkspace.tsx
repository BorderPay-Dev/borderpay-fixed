import React, { useCallback, useEffect, useState } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import { AppShell, type AppRoute } from '../shell/AppShell';
import { TransactionsScreen } from '../transactions/TransactionsScreen';
import { supabase } from '../../utils/supabase/client';

type Summary = {
 mode: 'receiving_paused' | 'locked';
 wallets?: Array<{ id: string; currency: string; balance: string; updated_at: string | null }>;
 receiving_currencies?: string[];
};
function amount(value: string) {
 if (!/^-?\d+(\.\d+)?$/.test(value)) return 'Unavailable';
 const [whole, fraction = '00'] = value.split('.');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction;
}
export function PausedAccountWorkspace({ userId, name, isBusiness, onSignOut, onLock }: {
 userId: string; name: string; isBusiness: boolean; onSignOut: () => void; onLock?: () => void;
}) {
 const [route, setRoute] = useState<AppRoute>('dashboard');
 const [summary, setSummary] = useState<Summary | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const load = useCallback(async () => {
  setLoading(true); setError(''); setSummary(null);
  const { data, error: failed } = await supabase.rpc('paused_account_wallet_summary');
  if (failed) setError(failed.message.includes('FINANCIAL_AUTH_REQUIRED')
   ? 'Please authenticate again to view your financial information.'
   : 'We could not load your wallet information. Please try again or contact support.');
  else setSummary(data as Summary);
  setLoading(false);
 }, [userId]);
 useEffect(() => { void load(); }, [load]);
 const locked = summary?.mode === 'locked';
 const walletView = route === 'dashboard' || route === 'wallet';
 return <div className="fixed inset-0 overflow-y-auto bg-[#080A0D] text-white">
  <AppShell route={route} onRoute={setRoute} userName={name} unreadCount={0} isBusinessAccount={isBusiness} onSignOut={onSignOut} onLock={onLock}>
   <main className="mx-auto w-full max-w-3xl px-5 pb-28 pt-6">
    <div role="status" className="mb-6 flex gap-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
     <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true"/>
     <div><h1 className="font-semibold">{locked ? 'Your account is restricted' : 'Your receiving accounts are frozen'}</h1>
     <p className="mt-1 text-sm leading-6 text-white/70">{locked
      ? 'Financial actions remain unavailable while the account restriction is in place.'
      : 'Receiving payments and viewing bank payment details are unavailable. You can still view your recorded wallet balances.'}</p></div>
    </div>
    {loading && <p role="status" className="text-sm text-white/70">Loading wallet information…</p>}
    {error && <div role="alert" className="rounded-2xl border border-white/10 p-5"><p>{error}</p><button className="mt-4 underline" onClick={() => void load()}>Try again</button></div>}
    {!loading && !error && summary && !locked && (walletView ? <>
     <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Wallet balances</h2>
      <button aria-label="Refresh wallet balances" onClick={() => void load()} className="rounded-full border border-white/15 p-3"><RefreshCw className="h-4 w-4"/></button></div>
     <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      {(summary.wallets || []).map(w => <div key={w.id} className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-5 last:border-b-0">
       <div><p className="font-semibold">{w.currency}</p><p className="mt-1 text-xs text-white/50">Recorded wallet balance</p></div>
       <p className="break-all text-right text-lg font-semibold tabular-nums">{amount(w.balance)} <span className="text-xs text-white/60">{w.currency}</span></p>
      </div>)}
      {!summary.wallets?.length && <p className="p-5 text-sm text-white/70">No wallet balances are currently available to display.</p>}
     </div>
     <p className="mt-4 text-xs leading-5 text-white/50">Balances reflect the latest recorded wallet information. A displayed balance does not confirm withdrawal eligibility.</p>
    </> : route === 'receive' ? <section className="rounded-3xl border border-white/10 p-5">
     <h2 className="text-xl font-semibold">Receive is frozen</h2>
     <p className="mt-3 text-sm leading-6 text-white/70">Do not ask anyone to send money to your previous receiving details. Bank account numbers, payment instructions and wallet deposit addresses are locked.</p>
     {(summary.receiving_currencies || []).map(currency => <div key={currency} className="mt-4 flex justify-between border-t border-white/10 pt-4"><span>{currency} receiving account</span><span className="text-amber-300">Frozen</span></div>)}
    </section> : route === 'send' ? <section className="rounded-3xl border border-white/10 p-5">
     <h2 className="text-xl font-semibold">Withdraw remaining funds</h2>
     <p className="mt-3 text-sm leading-6 text-white/70">Contact BorderPay support to review the return of your remaining wallet funds. Direct payments remain unavailable while your account is paused. Funds subject to a fraud hold cannot be withdrawn until the hold is released.</p>
     <a href="mailto:support@borderpayafrica.com?subject=Remaining%20wallet%20funds" className="mt-6 inline-flex rounded-2xl bg-[#c7ff00] px-5 py-3 font-semibold text-black">Contact support</a>
    </section> : route === 'transactions' ? <TransactionsScreen userId={userId} onBack={() => setRoute('wallet')} /> : <section className="rounded-3xl border border-white/10 p-5">
     <h2 className="text-xl font-semibold">This feature is currently locked</h2><p className="mt-3 text-sm leading-6 text-white/70">Your wallet overview and support remain available while receiving services are paused.</p>
     <button onClick={() => setRoute('wallet')} className="mt-5 underline">View wallets</button>
    </section>)}
    <p className="mt-7 text-sm text-white/60">Need help? <a className="underline" href="mailto:support@borderpayafrica.com">Contact BorderPay support</a></p>
   </main>
  </AppShell>
 </div>;
}
