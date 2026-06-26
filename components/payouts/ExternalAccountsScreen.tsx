/**
 * ExternalAccountsScreen — list & manage fiat payout (offramp) destinations.
 *
 * Reads the local RLS-protected mirror (public.bridge_external_accounts via
 * backendAPI.bridge.externalAccount.list) — no edge round-trip for a read.
 * Remove proxies the `bridge-external-account` edge function.
 *
 * Reached only when EXTERNAL_ACCOUNTS_LIVE is true (gated in MainApp).
 */

import React, { useEffect, useState } from 'react';
import { friendlyError } from '../../utils/errors/friendlyError';
import { Plus, Banknote, Loader2, Trash2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useVerification } from '../../utils/verification/useVerification';
import { authAPI } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface ExternalAccountRow {
  id: string;
  bridge_external_account_id: string;
  account_type: 'us' | 'iban';
  currency: string;
  account_owner_name: string | null;
  bank_name: string | null;
  last_4: string | null;
  rail: string | null;
  status: string;
}

interface ExternalAccountsScreenProps {
  onBack: () => void;
  onAdd: () => void;
}

// Native-app pattern: cache the last-loaded list so the screen mounts INSTANTLY
// with known data on the next visit, then refreshes in the background.
const CACHE_KEY = 'borderpay_payout_accounts_v1';
function readCache(): ExternalAccountRow[] {
  try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export function ExternalAccountsScreen({ onBack, onAdd }: ExternalAccountsScreenProps) {
  const tc = useThemeClasses();
  const userId = (authAPI.getStoredUser()?.id as string) || '';
  const verification = useVerification(userId);
  const cached = readCache();
  const [rows, setRows] = useState<ExternalAccountRow[]>(cached);
  // Only show skeletons when we have nothing cached to render instantly.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // Background refresh — never blanks the cached view; no setLoading(true) here.
  const load = async () => {
    setError(null);
    try {
      const r: any = await backendAPI.bridge.externalAccount.list();
      if (r?.success) {
        const next = (r.data?.external_accounts || []) as ExternalAccountRow[];
        setRows(next);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      } else if (rows.length === 0) {
        setError(friendlyError(r?.error, 'Could not load payout accounts'));
      }
    } catch (e: any) {
      if (rows.length === 0) setError(friendlyError(e, 'Could not load payout accounts'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const prefetch = (window as any).__borderpay_prefetch;
    if (typeof prefetch === 'function') {
      const warm = () => {
        ['add-external-account', 'send-money', 'wallet-detail', 'transactions', 'settings'].forEach((s) => {
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
  }, []);
  useEffect(() => { setIsVerified(readCachedVerified()); }, [userId]);

  const remove = async (extId: string) => {
    setRemoving(extId);
    try {
      const r: any = await backendAPI.bridge.externalAccount.remove(extId);
      if (r?.success) {
        toast.success('Payout account removed.');
        setRows(prev => {
          const next = prev.filter(x => x.bridge_external_account_id !== extId);
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* quota */ }
          return next;
        });
      } else {
        toast.error(friendlyError(r?.error, 'Could not remove the payout account.'));
      }
    } catch (e: any) {
      toast.error(friendlyError(e, 'Could not remove the payout account.'));
    } finally {
      setRemoving(null);
    }
  };

  const railLabel = (row: ExternalAccountRow) =>
    row.account_type === 'us' ? 'ACH · Wire' : 'SEPA';

  // Lock door: payout destinations are only available once the user is
  // verified/activated (same gate as Receive / Send / Add money).
  if (!verification.isVerified) {
    return (
      <div className={`min-h-screen ${tc.bg}`}>
        <FloatingBackButton onBack={onBack} />
        <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-10">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
            External Accounts
          </p>
          <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 text-center`}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-amber-400" />
            </div>
            <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Verification required</h2>
            <p className={`text-sm ${tc.textMuted} max-w-sm mx-auto leading-relaxed`}>
              Verify your identity to add a payout destination and withdraw funds.
            </p>
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
        <h1 className={`text-base font-semibold ${tc.text}`}>External Accounts</h1>
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#C7FF00] text-black text-xs font-bold">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-md mx-auto">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map(i => (
              <div key={i} className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 flex items-center gap-3 animate-pulse`}>
                <div className={`w-10 h-10 rounded-xl ${tc.bgAlt}`} />
                <div className="flex-1 space-y-2">
                  <div className={`h-3 w-32 rounded ${tc.bgAlt}`} />
                  <div className={`h-2.5 w-20 rounded ${tc.bgAlt}`} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-4">
              <Banknote className="w-6 h-6 text-[#C7FF00]" />
            </div>
            <p className={`text-sm font-semibold ${tc.text} mb-1`}>No external accounts yet</p>
            <p className={`text-xs ${tc.textMuted} mb-5`}>Add a bank account to receive payouts through BorderPay.</p>
            <button onClick={onAdd} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#C7FF00] text-black text-sm font-bold">
              <Plus className="w-4 h-4" /> Add payout account
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(row => (
              <div key={row.id} className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 flex items-center justify-between`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0">
                    <Banknote className="w-5 h-5 text-[#C7FF00]" />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${tc.text} truncate`}>
                      {row.bank_name || row.account_owner_name || 'Bank account'}
                    </p>
                    <p className={`text-xs ${tc.textMuted}`}>
                      {row.currency} · {railLabel(row)}{row.last_4 ? ` · ••${row.last_4}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => remove(row.bridge_external_account_id)}
                  disabled={removing === row.bridge_external_account_id}
                  className={`w-9 h-9 rounded-full flex items-center justify-center ${tc.hoverBg} disabled:opacity-50`}
                  aria-label="Remove"
                >
                  {removing === row.bridge_external_account_id
                    ? <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                    : <Trash2 className="w-4 h-4 text-red-400" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default ExternalAccountsScreen;
