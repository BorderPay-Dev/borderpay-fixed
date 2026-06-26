/**
 * ExternalWalletsScreen — saved external stablecoin payout addresses.
 *
 * Save your own wallet address once (e.g. your Binance USDC/Base address), then
 * withdraw to it from inside the app — gated by passcode/biometric in the send
 * flow. Native-app feel: floating back, cache-seeded list (instant mount, no
 * loading), skeleton only on a cold first load.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Wallet, Trash2, ArrowUpRight, Shield, X, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type ExternalWallet } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { SkeletonRows } from '../common/Skeleton';
import { useVerification } from '../../utils/verification/useVerification';
import { isAccountActivated } from '../../utils/subscriptions/gate';
import { authAPI } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { financialCacheKey } from '../../utils/financial/cacheScope';

interface Props {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const CACHE_KEY = 'borderpay_external_wallets_v1';
const PREFILL_KEY = 'borderpay_prefill_withdraw';   // read by SendMoneyFlow

const CHAINS = [
  { code: 'base', name: 'Base' }, { code: 'ethereum', name: 'Ethereum' },
  { code: 'polygon', name: 'Polygon' }, { code: 'arbitrum', name: 'Arbitrum' },
  { code: 'optimism', name: 'Optimism' }, { code: 'tron', name: 'Tron' },
  { code: 'solana', name: 'Solana' },
];
const EVM = new Set(['base', 'ethereum', 'polygon', 'arbitrum', 'optimism']);
const chainName = (c: string) => CHAINS.find(x => x.code === c)?.name || c;

function validAddress(chain: string, a: string): boolean {
  const v = (a || '').trim();
  if (EVM.has(chain))     return /^0x[a-fA-F0-9]{40}$/.test(v);
  if (chain === 'tron')   return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);
  if (chain === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
  return false;
}

function readCache(cacheKey: string): ExternalWallet[] {
  try { const v = JSON.parse(localStorage.getItem(cacheKey) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export function ExternalWalletsScreen({ onBack, onNavigate }: Props) {
  const tc = useThemeClasses();
  const userId = (authAPI.getStoredUser()?.id as string) || '';
  const verification = useVerification(userId);
  const cacheKey = financialCacheKey(CACHE_KEY, { userId });
  const refreshTsKey = financialCacheKey('borderpay_external_wallets_refresh_ts_v1', { userId });

  const cached = readCache(cacheKey);
  const [wallets, setWallets] = useState<ExternalWallet[]>(cached);
  const [loading, setLoading] = useState(cached.length === 0);
  const [adding, setAdding]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // add-form state
  const [label, setLabel]     = useState('');
  const [chain, setChain]     = useState('base');
  const [asset, setAsset]     = useState('USDC');
  const [address, setAddress] = useState('');

  const load = async (force = false) => {
    const seededWallets = wallets.length > 0 ? wallets : readCache(cacheKey);
    const isColdStart = seededWallets.length === 0;
    try {
      const last = Number(localStorage.getItem(refreshTsKey) || '0');
      if (!force && !isColdStart && Number.isFinite(last) && Date.now() - last < 45_000) return;
      const r: any = await backendAPI.externalWallets.list();
      if (r?.success) {
        const next: ExternalWallet[] = Array.isArray(r.data?.external_wallets) ? r.data.external_wallets : [];
        const normalized: ExternalWallet[] = next.length > 0
          ? next
          : (Array.isArray(r.data?.wallets) ? r.data.wallets : []);
        setWallets(normalized);
        try { localStorage.setItem(cacheKey, JSON.stringify(normalized)); } catch { /* quota */ }
        try { localStorage.setItem(refreshTsKey, String(Date.now())); } catch { /* noop */ }
      }
    } catch { /* keep cache */ }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const prefetch = (window as any).__borderpay_prefetch;
    if (typeof prefetch === 'function') {
      const warm = () => {
        ['send-money', 'wallet-detail', 'external-accounts', 'transactions', 'settings'].forEach((s) => {
          try { prefetch(s); } catch { /* noop */ }
        });
      };
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(warm, { timeout: 1000 });
      else setTimeout(warm, 220);
    }

    load();
    const onFocus = () => { void load(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!label.trim()) { toast.error('Add a name for this wallet.'); return; }
    if (!validAddress(chain, address)) { toast.error(`That address isn't valid for ${chainName(chain)}.`); return; }
    setSaving(true);
    try {
      const r: any = await backendAPI.externalWallets.add({ label: label.trim(), chain, asset, address: address.trim() });
      if (r?.success && r.data?.wallet) {
        const next = [r.data.wallet, ...wallets.filter(w => w.id !== r.data.wallet.id)];
        setWallets(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
        setAdding(false); setLabel(''); setAddress('');
        toast.success('Wallet saved.');
      } else {
        toast.error(friendlyError(r?.error, 'Could not save that wallet.'));
      }
    } catch (e) { toast.error(friendlyError(e, 'Could not save that wallet.')); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      const r: any = await backendAPI.externalWallets.remove(id);
      if (r?.success) {
        const next = wallets.filter(w => w.id !== id);
        setWallets(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
      } else { toast.error(friendlyError(r?.error, 'Could not remove that wallet.')); }
    } catch (e) { toast.error(friendlyError(e, 'Could not remove that wallet.')); }
    finally { setRemoving(null); }
  };

  const withdraw = (w: ExternalWallet) => {
    // Hand off to the stablecoin send flow with the destination prefilled.
    try { localStorage.setItem(PREFILL_KEY, JSON.stringify({ address: w.address, chain: w.chain, asset: w.asset })); } catch { /* noop */ }
    onNavigate?.('send-money');
  };

  // Lock door — same gate as payouts.
  if (!verification.isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <FloatingBackButton onBack={onBack} />
        <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>Withdrawal wallets</p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto leading-relaxed`}>
              Verify your identity to save withdrawal wallets and move funds.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Activation lock — withdrawal wallets unlock only after the one-time
  // activation is paid (verified users still see this until they activate).
  if (!isAccountActivated()) {
    const isBiz = authAPI.getStoredUser()?.account_type === 'business';
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <FloatingBackButton onBack={onBack} />
        <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>Withdrawal wallets</p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-[#C7FF00]" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Activate to unlock withdrawals</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto leading-relaxed mb-6`}>
              Fund your BorderPay wallet ($20 minimum) to save withdrawal addresses and move funds out. Your funds remain yours.
            </p>
            <button
              onClick={() => (window as any).__borderpay_open_upgrade?.(isBiz ? 'business_activated' : 'individual_activated')}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#C7FF00] text-black text-sm font-bold hover:brightness-95 transition"
            >
              Activate <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <header
        className="flex items-center justify-between pl-16 pr-5 sm:pr-6 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.85rem)' }}
      >
        <h1 className={`text-base font-semibold ${tc.text}`}>Withdrawal wallets</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            aria-label="Refresh wallets"
            className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center ${tc.hoverBg}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${tc.textMuted} ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#C7FF00] text-black text-xs font-bold">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-md mx-auto">
        <p className={`text-[12px] ${tc.textMuted} mb-4 leading-snug`}>
          Save your own stablecoin address (e.g. from an exchange). Withdraw to it anytime —
          confirmed with your PIN or biometric.
        </p>

        {loading && wallets.length === 0 ? (
          <SkeletonRows count={3} />
        ) : wallets.length === 0 ? (
          <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} px-5 py-10 text-center`}>
            <Wallet className={`w-7 h-7 ${tc.textMuted} mx-auto mb-3`} />
            <p className={`text-sm font-medium ${tc.text}`}>No saved wallets yet</p>
            <p className={`text-[11px] ${tc.textMuted} mt-1`}>Add an address to withdraw to it directly.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {wallets.map(w => (
              <div key={w.id} className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-4`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#C7FF00]/15 flex items-center justify-center flex-shrink-0">
                    <Wallet className="w-4 h-4 text-[#C7FF00]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tc.text} truncate`}>{w.label}</p>
                    <p className={`text-[11px] ${tc.textMuted}`}>{w.asset} · {chainName(w.chain)}</p>
                    <p className={`text-[10px] ${tc.textMuted} font-mono truncate`}>{w.address.slice(0, 10)}…{w.address.slice(-8)}</p>
                  </div>
                  <button
                    onClick={() => remove(w.id)}
                    disabled={removing === w.id}
                    aria-label="Remove"
                    className={`p-2 rounded-full ${tc.hoverBg} flex-shrink-0`}
                  >
                    {removing === w.id ? <Loader2 className="w-4 h-4 animate-spin text-red-400" /> : <Trash2 className="w-4 h-4 text-red-400" />}
                  </button>
                </div>
                <button
                  onClick={() => withdraw(w)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#C7FF00] text-black text-xs font-bold hover:brightness-95 transition"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" /> Withdraw to this wallet
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add sheet */}
      {adding && (
        <>
          <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm" onClick={() => !saving && setAdding(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[9999] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-sm"
               style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <div className={`mx-auto w-full max-w-md ${tc.card} border ${tc.cardBorder} rounded-t-3xl sm:rounded-3xl p-5`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-base font-semibold ${tc.text}`}>Add withdrawal wallet</h2>
                <button onClick={() => !saving && setAdding(false)} aria-label="Close" className={`p-2 rounded-full ${tc.hoverBg}`}>
                  <X className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
              </div>
              <div className="space-y-3">
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Name (e.g. My Binance)"
                  className={`w-full ${tc.inputBg} border ${tc.cardBorder} rounded-2xl px-4 py-3 text-sm ${tc.text} focus:outline-none focus:border-[#C7FF00]/50`} />
                <div className="flex gap-2">
                  <select value={asset} onChange={e => setAsset(e.target.value)}
                    className={`flex-1 ${tc.inputBg} border ${tc.cardBorder} rounded-2xl px-3 py-3 text-sm ${tc.text} focus:outline-none`}>
                    <option value="USDC">USDC</option><option value="USDT">USDT</option>
                  </select>
                  <select value={chain} onChange={e => setChain(e.target.value)}
                    className={`flex-1 ${tc.inputBg} border ${tc.cardBorder} rounded-2xl px-3 py-3 text-sm ${tc.text} focus:outline-none`}>
                    {CHAINS.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </div>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder={`${chainName(chain)} address`}
                  className={`w-full ${tc.inputBg} border ${tc.cardBorder} rounded-2xl px-4 py-3 text-sm font-mono ${tc.text} focus:outline-none focus:border-[#C7FF00]/50`} />
                <button onClick={save} disabled={saving}
                  className="w-full py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition disabled:opacity-60 inline-flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save wallet
                </button>
                <p className={`text-[10px] ${tc.textMuted} text-center`}>
                  Double-check the address and network. Stablecoin transfers can't be reversed.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ExternalWalletsScreen;
