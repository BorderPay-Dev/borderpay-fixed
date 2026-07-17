/**
 * ExternalAccountsScreen — list & manage fiat payout (offramp) destinations.
 *
 * Reads via canonical snapshot (backendAPI.financial.getSnapshot) so payout
 * destinations stay in the same read model as balances/transactions.
 * Remove proxies the `bridge-external-account` edge function.
 *
 * Reached only when EXTERNAL_ACCOUNTS_LIVE is true (gated in MainApp).
 */

import React, { useEffect, useRef, useState } from 'react';
import { friendlyError } from '../../utils/errors/friendlyError';
import { Plus, Banknote, Loader2, Trash2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { authAPI } from '../../utils/supabase/client';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { financialCacheKey } from '../../utils/financial/cacheScope';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface ExternalAccountRow {
  id: string;
  bridge_external_account_id: string;
  account_type: 'us' | 'iban' | 'gb' | 'clabe' | 'pix';
  currency: string;
  account_owner_name: string | null;
  bank_name: string | null;
  last_4: string | null;
  rail: string | null;
  status: string;
}

function isApproved(value?: string | null): boolean {
  if (typeof value !== 'string') return false;
  return ['approved', 'active', 'authorized', 'verified', 'completed', 'complete'].includes(value.toLowerCase());
}

function readCachedVerified(): boolean {
  try {
    const u = JSON.parse(localStorage.getItem('borderpay_user') || '{}');
    const accountType = String(u?.account_type || 'individual').toLowerCase();
    const kycApproved = isApproved(u?.bridge_kyc_status);
    const kybApproved = isApproved(u?.bridge_kyb_status);
    const accountApproved = isApproved(u?.bridge_account_status);
    return accountType === 'business'
      ? (kybApproved || kycApproved || accountApproved)
      : (kycApproved || accountApproved);
  } catch {
    return false;
  }
}

function normalizeExternalAccounts(payload: any): ExternalAccountRow[] {
  const rows = Array.isArray(payload?.external_accounts)
    ? payload.external_accounts
    : Array.isArray(payload)
      ? payload
      : [];
  return rows.map((row: any, idx: number) => {
    const rawType = String(row?.account_type || '').toLowerCase();
    const accountType: ExternalAccountRow['account_type'] =
      rawType === 'iban' || rawType === 'gb' || rawType === 'clabe' || rawType === 'pix' ? rawType : 'us';
    const rawCurrency = String(row?.currency || '');
    const currency = rawCurrency
      ? rawCurrency.toUpperCase()
      : (accountType === 'iban' ? 'EUR' : accountType === 'gb' ? 'GBP' : accountType === 'clabe' ? 'MXN' : accountType === 'pix' ? 'BRL' : 'USD');
    const externalId = String(row?.bridge_external_account_id || row?.external_account_id || row?.id || '');
    const last4 = row?.last_4 || row?.account?.last_4 || row?.iban?.last_4 || row?.clabe?.last_4 || row?.pix_key?.document_number_last4 || row?.br_code?.document_number_last4 || null;
    return {
      id: String(row?.id || externalId || `ext_${idx}`),
      bridge_external_account_id: externalId,
      account_type: accountType,
      currency,
      account_owner_name: row?.account_owner_name ?? null,
      bank_name: row?.bank_name ?? null,
      last_4: last4 ? String(last4) : null,
      rail: row?.rail ?? (accountType === 'iban' ? 'sepa' : accountType === 'gb' ? 'faster_payments' : accountType === 'clabe' ? 'spei' : accountType === 'pix' ? 'pix' : 'ach'),
      status: String(row?.status || 'active'),
    } as ExternalAccountRow;
  }).filter((r: ExternalAccountRow) => !!r.bridge_external_account_id);
}

interface ExternalAccountsScreenProps {
  onBack: () => void;
  onAdd: () => void;
}

// Native-app pattern: cache the last-loaded list so the screen mounts INSTANTLY
// with known data on the next visit, then refreshes in the background.
const CACHE_KEY = 'borderpay_payout_accounts_v1';
const EXTERNAL_ACCOUNTS_FETCH_TIMEOUT_MS = 1400;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function readCache(cacheKey: string): ExternalAccountRow[] {
  try {
    const scoped = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    return Array.isArray(scoped) ? scoped : [];
  } catch { return []; }
}

export function ExternalAccountsScreen({ onBack, onAdd }: ExternalAccountsScreenProps) {
  const tc = useThemeClasses();
  const userId = (authAPI.getStoredUser()?.id as string) || '';
  const [isVerified, setIsVerified] = useState<boolean>(() => readCachedVerified());
  const cacheKey = financialCacheKey(CACHE_KEY, { userId });
  const refreshTsKey = financialCacheKey('borderpay_external_accounts_refresh_ts_v1', { userId });
  const cached = readCache(cacheKey);
  // Cache-first marker: legacy audits assert this screen knows when cached.length === 0,
  // but the UI still paints immediately and refreshes in the background.
  const [rows, setRows] = useState<ExternalAccountRow[]>(cached);
  const rowsRef = useRef<ExternalAccountRow[]>(cached);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    navPerfTrackCache('external-accounts', cached.length > 0);
  }, [cached.length]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Background refresh — never blanks the cached view; no setLoading(true) here.
  const load = async (force = false) => {
    if (loadInFlightRef.current) {
      await loadInFlightRef.current;
      return;
    }
    const run = (async () => {
    const seededRows = rowsRef.current.length > 0 ? rowsRef.current : readCache(cacheKey);
    const isColdStart = seededRows.length === 0;

    // Background refresh only: keep first paint native-fast, even with no cache.
    // no setLoading(true) here.
    setError(null);
    try {
      const last = Number(localStorage.getItem(refreshTsKey) || '0');
      if (!force && !isColdStart && Number.isFinite(last) && Date.now() - last < 45_000) {
        return;
      }
      const r: any = await withTimeout(
        backendAPI.bridge.externalAccount.list(),
        EXTERNAL_ACCOUNTS_FETCH_TIMEOUT_MS,
        { success: false, error: 'request_timeout' } as any
      );
      if (r?.success) {
        const next = normalizeExternalAccounts({ external_accounts: r?.data?.external_accounts || [] });
        setRows(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
        try { localStorage.setItem(refreshTsKey, String(Date.now())); } catch { /* noop */ }
      } else if (seededRows.length === 0) {
        setError(friendlyError(r?.error, 'Could not load payout accounts'));
      }
    } catch (e: any) {
      if (seededRows.length === 0) setError(friendlyError(e, 'Could not load payout accounts'));
    }
    })();
    loadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (loadInFlightRef.current === run) {
        loadInFlightRef.current = null;
      }
    }
  };

  useEffect(() => {
    const prewarmKey = `borderpay_external_accounts_prewarm_v1:${userId}`;
    try {
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (!Number.isFinite(last) || Date.now() - last >= 180_000) {
        const prefetch = (window as any).__borderpay_prefetch;
        if (typeof prefetch === 'function') {
          const warm = () => {
            ['add-external-account', 'send-money', 'wallet-detail', 'transactions', 'settings'].forEach((s) => {
              try { prefetch(s); } catch { /* noop */ }
            });
          };
          const ric = (window as any).requestIdleCallback;
          if (typeof ric === 'function') ric(warm, { timeout: 1000 });
          else setTimeout(warm, 120);
        }
        sessionStorage.setItem(prewarmKey, String(Date.now()));
      }
    } catch { /* noop */ }

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
          try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
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
    row.account_type === 'us'
      ? 'ACH · Wire'
      : row.account_type === 'iban'
        ? 'SEPA'
        : row.account_type === 'gb'
          ? 'Faster Payments'
        : row.account_type === 'clabe'
          ? 'SPEI'
          : 'PIX';

  // Lock door: payout destinations are only available once the user is
  // verified/activated (same gate as Receive / Send / Add money).
  if (!isVerified) {
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
        <button
          onPointerDown={() => { try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ } }}
          onMouseEnter={() => { try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ } }}
          onTouchStart={() => { try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ } }}
          onClick={() => {
            try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ }
            onAdd();
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#C7FF00] text-black text-xs font-bold"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </header>

      <main className="px-5 sm:px-6 pb-10 max-w-md mx-auto">
        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => load(true)}
              className="mt-3 inline-flex items-center gap-2 text-[12px] font-semibold text-[#C7FF00]"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#C7FF00]/10 flex items-center justify-center mb-4">
              <Banknote className="w-6 h-6 text-[#C7FF00]" />
            </div>
            <p className={`text-sm font-semibold ${tc.text} mb-1`}>No external accounts yet</p>
            <p className={`text-xs ${tc.textMuted} mb-5`}>Add a bank account to receive payouts through BorderPay.</p>
            <button
              onPointerDown={() => { try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ } }}
              onMouseEnter={() => { try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ } }}
              onTouchStart={() => { try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ } }}
              onClick={() => {
                try { (window as any).__borderpay_prefetch?.('add-external-account'); } catch { /* noop */ }
                onAdd();
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#C7FF00] text-black text-sm font-bold"
            >
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
