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
import { ArrowLeft, Plus, Banknote, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { backendAPI } from '../../utils/api/backendAPI';
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

export function ExternalAccountsScreen({ onBack, onAdd }: ExternalAccountsScreenProps) {
  const tc = useThemeClasses();
  const [rows, setRows] = useState<ExternalAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r: any = await backendAPI.bridge.externalAccount.list();
      if (r?.success) {
        setRows((r.data?.external_accounts || []) as ExternalAccountRow[]);
      } else {
        setError(r?.error || 'Could not load payout accounts');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load payout accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (extId: string) => {
    setRemoving(extId);
    try {
      const r: any = await backendAPI.bridge.externalAccount.remove(extId);
      if (r?.success) {
        toast.success('Payout account removed.');
        setRows(prev => prev.filter(x => x.bridge_external_account_id !== extId));
      } else {
        toast.error(r?.error || 'Could not remove the payout account.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove the payout account.');
    } finally {
      setRemoving(null);
    }
  };

  const railLabel = (row: ExternalAccountRow) =>
    row.account_type === 'us' ? 'ACH · Wire' : 'SEPA';

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <header
        className="flex items-center justify-between px-5 sm:px-6 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)' }}
      >
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center`} aria-label="Back">
            <ArrowLeft className={`w-4 h-4 ${tc.text}`} />
          </button>
          <h1 className={`text-base font-semibold ${tc.text}`}>Payout accounts</h1>
        </div>
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
            <p className={`text-sm font-semibold ${tc.text} mb-1`}>No payout accounts yet</p>
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
