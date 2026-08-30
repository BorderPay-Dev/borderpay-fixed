/**
 * ExternalWalletsScreen — saved external stablecoin payout addresses.
 *
 * Save your own wallet address once (e.g. your Binance USDC/Base address). The
 * backend registers the matching Bridge crypto-to-crypto route before the wallet
 * can be used for withdrawals.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Wallet, Trash2, ArrowUpRight, Shield, X, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI, type ExternalWallet } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useVerification } from '../../utils/verification/useVerification';
import { authAPI } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { useBridgeScaAction } from '../../utils/security/useBridgeScaAction';

interface Props {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const CACHE_KEY = 'borderpay_external_wallets_v2';
const EXTERNAL_WALLETS_FETCH_TIMEOUT_MS = 1400;
const PREFILL_KEY = 'borderpay_prefill_withdraw';   // read by SendMoneyFlow

const WITHDRAWAL_ROUTES = [
  { key: 'USDC:base', asset: 'USDC', chain: 'base', label: 'USDC · Base' },
  { key: 'USDT:tron', asset: 'USDT', chain: 'tron', label: 'USDT · Tron' },
] as const;
const chainName = (c: string) => c.toLowerCase() === 'base' ? 'Base' : c.toLowerCase() === 'tron' ? 'Tron' : c;
const walletRouteKey = (asset: string, chain: string) => `${String(asset).toUpperCase()}:${String(chain).toLowerCase()}`;
const isSupportedWithdrawalWallet = (w: Pick<ExternalWallet, 'asset' | 'chain'>) =>
  WITHDRAWAL_ROUTES.some(route => route.key === walletRouteKey(w.asset, w.chain));
const filterSupportedWallets = (wallets: ExternalWallet[]) => wallets.filter(isSupportedWithdrawalWallet);

function validAddress(chain: string, a: string): boolean {
  const v = (a || '').trim();
  if (chain === 'base')   return /^0x[a-fA-F0-9]{40}$/.test(v);
  if (chain === 'tron')   return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);
  return false;
}

function readCache(cacheKey: string): ExternalWallet[] {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    return Array.isArray(v) ? filterSupportedWallets(v) : [];
  }
  catch { return []; }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export function ExternalWalletsScreen({ onBack, onNavigate }: Props) {
  const tc = useThemeClasses();
  const { authorize: authorizeBridgeSca, challenge: scaChallenge } = useBridgeScaAction();
  const snapshotReader = backendAPI.financial.getSnapshot;
  void snapshotReader;
  const userId = (authAPI.getStoredUser()?.id as string) || '';
  const verification = useVerification(userId);
  const cacheKey = financialCacheKey(CACHE_KEY, { userId });

  const cached = readCache(cacheKey);
  useEffect(() => {
    navPerfTrackCache('external-wallets', cached.length > 0);
  }, [cached.length]);
  const [wallets, setWallets] = useState<ExternalWallet[]>(cached);
  const [adding, setAdding]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // add-form state
  const [label, setLabel]     = useState('');
  const [chain, setChain]     = useState('base');
  const [asset, setAsset]     = useState('USDC');
  const [address, setAddress] = useState('');
  const selectedRouteKey = walletRouteKey(asset, chain);

  const load = async () => {
    try {
      const r: any = await withTimeout(
        backendAPI.externalWallets.list(),
        EXTERNAL_WALLETS_FETCH_TIMEOUT_MS,
        { success: false, error: 'request_timeout' } as any
      );
      if (r?.success) {
        const next: ExternalWallet[] = filterSupportedWallets(r.data?.wallets || []);
        setWallets(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
      }
    } catch { /* keep cache */ }
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
      else setTimeout(warm, 120);
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
    if (!WITHDRAWAL_ROUTES.some(route => route.key === selectedRouteKey)) {
      toast.error('Choose USDC on Base or USDT on Tron.');
      return;
    }
    if (!validAddress(chain, address)) { toast.error(`That address isn't valid for ${chainName(chain)}.`); return; }
    try {
      const request = { action: 'add', label: label.trim(), chain, asset, address: address.trim() };
      const authorizationId = await authorizeBridgeSca({
        operation: 'beneficiary_change',
        resource: 'external_wallet',
        request,
        title: 'Confirm withdrawal wallet',
        description: 'Verify this beneficiary change with your account password and authenticator code.',
      });
      await saveAuthorized(authorizationId);
    } catch (error) {
      toast.error(friendlyError(error, 'Wallet creation was cancelled.'));
    }
  };

  const saveAuthorized = async (authorizationId: string) => {
    setSaving(true);
    try {
      const r: any = await backendAPI.externalWallets.add({ label: label.trim(), chain, asset, address: address.trim() }, authorizationId);
      if (r?.success && r.data?.wallet) {
        const next = filterSupportedWallets([r.data.wallet, ...wallets.filter(w => w.id !== r.data.wallet.id)]);
        setWallets(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
        setAdding(false); setLabel(''); setAddress(''); setAsset('USDC'); setChain('base');
        toast.success('Wallet saved.');
      } else {
        toast.error(friendlyError(r?.error, 'Could not save that wallet.'));
      }
    } catch (e) { toast.error(friendlyError(e, 'Could not save that wallet.')); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try {
      const authorizationId = await authorizeBridgeSca({
        operation: 'beneficiary_change',
        resource: 'external_wallet',
        request: { action: 'remove', id },
        title: 'Confirm withdrawal wallet removal',
        description: 'Verify this beneficiary change with your account password and authenticator code.',
      });
      await removeAuthorized(id, authorizationId);
    } catch (error) {
      toast.error(friendlyError(error, 'Wallet removal was cancelled.'));
    }
  };

  const removeAuthorized = async (id: string, authorizationId: string) => {
    setRemoving(id);
    try {
      const r: any = await backendAPI.externalWallets.remove(id, authorizationId);
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
    try {
      localStorage.setItem(PREFILL_KEY, JSON.stringify({
        address: w.address,
        chain: w.chain,
        asset: w.asset,
        external_wallet_id: w.id,
        bridge_payment_route_id: w.bridge_payment_route_id,
        bridge_payment_route_status: w.bridge_payment_route_status,
        bridge_payment_route_raw: w.bridge_payment_route_raw || null,
        label: w.label,
        created_at: w.created_at,
      }));
    } catch { /* noop */ }
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

  // Withdrawal wallets require account verification.
  const storedUser = authAPI.getStoredUser();
  const verified = ['verified', 'approved', 'active'].includes(
    String(storedUser?.derived_kyc_status || storedUser?.kyc_status || storedUser?.bridge_kyc_status || storedUser?.bridge_kyb_status || '').toLowerCase(),
  );
  if (!verified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <FloatingBackButton onBack={onBack} />
        <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>Withdrawal wallets</p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-7 h-7 text-[#C7FF00]" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verify your account to unlock withdrawals</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto leading-relaxed mb-6`}>
              Complete verification to save withdrawal addresses and move funds out.
            </p>
            <button
              onClick={() => (window as any).__borderpay_navigate?.('kyc')}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#C7FF00] text-black text-sm font-bold hover:brightness-95 transition"
            >
              Verify now <ArrowUpRight className="w-4 h-4" />
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
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#C7FF00] text-black text-xs font-bold">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-md mx-auto">
        <p className={`text-[12px] ${tc.textMuted} mb-4 leading-snug`}>
          Save your own digital dollar address (e.g. from an exchange). Withdraw to it anytime —
          confirmed with your PIN or biometric.
        </p>

        {wallets.length === 0 ? (
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
                    <p className={`text-[10px] ${w.bridge_payment_route_id ? 'text-[#C7FF00]' : 'text-amber-400'} truncate`}>
                      {w.bridge_payment_route_id ? 'BorderPay route active' : 'Saved wallet'}
                    </p>
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
                <select
                  value={selectedRouteKey}
                  onChange={e => {
                    const route = WITHDRAWAL_ROUTES.find(x => x.key === e.target.value) || WITHDRAWAL_ROUTES[0];
                    setAsset(route.asset);
                    setChain(route.chain);
                    setAddress('');
                  }}
                  className={`w-full ${tc.inputBg} border ${tc.cardBorder} rounded-2xl px-3 py-3 text-sm ${tc.text} focus:outline-none`}
                >
                  {WITHDRAWAL_ROUTES.map(route => (
                    <option key={route.key} value={route.key}>{route.label}</option>
                  ))}
                </select>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder={`${chainName(chain)} address`}
                  className={`w-full ${tc.inputBg} border ${tc.cardBorder} rounded-2xl px-4 py-3 text-sm font-mono ${tc.text} focus:outline-none focus:border-[#C7FF00]/50`} />
                <button onClick={save} disabled={saving}
                  className="w-full py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition disabled:opacity-60 inline-flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save wallet
                </button>
                <p className={`text-[10px] ${tc.textMuted} text-center`}>
                  Double-check the address and network. Digital dollar transfers can't be reversed.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
      {scaChallenge}
    </div>
  );
}

export default ExternalWalletsScreen;
