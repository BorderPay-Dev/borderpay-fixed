/**
 * BulkPayoutScreen — one batch, many recipients (payroll / supplier /
 * contractor / marketplace / creator payouts). Runs the same validated transfer
 * rail once per row via `backendAPI.payouts.bulkPayout`. Each row gets its own
 * idempotency key so a retry never double-pays.
 *
 * African corridors settle as external stablecoin (USDT/USDC to the payee's
 * wallet address) — same primitive the single Send uses.
 */

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Users, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { backendAPI } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';
import { isAccountActivated } from '../../utils/subscriptions/gate';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { toast } from 'sonner';

interface Row { label: string; chain: string; address: string; amount: string }

type Asset = 'USDC' | 'USDT';
// Chains each stablecoin is actually issued on (Bridge-supported).
const CHAINS_BY_ASSET: Record<Asset, string[]> = {
  USDC: ['solana', 'ethereum', 'base', 'polygon'],
  USDT: ['tron', 'ethereum', 'solana', 'polygon'],
};
const defaultChain = (a: Asset) => CHAINS_BY_ASSET[a][0];

const blankRow = (chain: string): Row => ({ label: '', chain, address: '', amount: '' });

export interface BulkPayoutScreenProps {
  onBack: () => void;
}

export function BulkPayoutScreen({ onBack }: BulkPayoutScreenProps) {
  const tc = useThemeClasses();
  const [asset, setAsset] = useState<Asset>('USDC');
  const [rows, setRows] = useState<Row[]>([blankRow(defaultChain('USDC')), blankRow(defaultChain('USDC'))]);
  const [submitting, setSubmitting] = useState(false);

  // Switching stablecoin resets each row's chain to one that asset is issued on.
  const switchAsset = (a: Asset) => {
    setAsset(a);
    setRows((rs) => rs.map((r) => (CHAINS_BY_ASSET[a].includes(r.chain) ? r : { ...r, chain: defaultChain(a) })));
  };
  const [results, setResults] = useState<null | {
    summary: { total: number; submitted: number; failed: number; total_amount: number; currency: string };
    results: Array<{ row: number; label: string | null; state: string; error?: string }>;
  }>(null);

  const valid = rows.filter((r) => r.address.trim() && Number(r.amount) > 0);
  const total = useMemo(() => valid.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow(defaultChain(asset))]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const submit = async () => {
    if (!isAccountActivated()) {
      (window as any).__borderpay_open_upgrade?.('business_activated');
      return;
    }
    if (valid.length === 0) { toast.error('Add at least one recipient with an address and amount.'); return; }
    if (!confirm(
      `Send ${valid.length} payout${valid.length > 1 ? 's' : ''} totalling $${total.toFixed(2)} ${asset}?\n\n` +
      `This moves real money. Double-check the addresses — stablecoin transfers cannot be reversed.`
    )) return;

    setSubmitting(true);
    setResults(null);
    try {
      const items = valid.map((r) => ({
        label: r.label.trim() || undefined,
        amount: String(r.amount),
        idempotency_key: (crypto as any).randomUUID(),
        source_chain: r.chain,
        destination: { payment_rail: 'stablecoin', currency: asset, chain: r.chain, address: r.address.trim() },
      }));
      const res: any = await backendAPI.payouts.bulkPayout({ source_currency: asset, items });
      if (res?.success && res.data) {
        setResults(res.data);
        const { submitted, failed } = res.data.summary;
        if (failed === 0) toast.success(`${submitted} payout${submitted > 1 ? 's' : ''} submitted.`);
        else toast.error(`${submitted} submitted, ${failed} failed — see results below.`);
      } else {
        toast.error(friendlyError(res?.error, 'Could not submit the batch. Please try again.'));
      }
    } catch (e) {
      toast.error(friendlyError(e, 'Could not submit the batch. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen ${tc.bg} pt-floating-back`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-5 pb-28">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-[#C7FF00]/15 flex items-center justify-center">
            <Users className="w-4.5 h-4.5 text-[#C7FF00]" />
          </div>
          <h1 className={`text-xl font-bold ${tc.text}`}>Bulk payout</h1>
        </div>
        <p className={`text-sm ${tc.textMuted} mb-6`}>
          Pay many recipients at once — payroll, suppliers, contractors. Each row is paid in {asset}.
        </p>

        {results ? (
          <ResultsView data={results} tc={tc} onDone={onBack} onAnother={() => { setResults(null); setRows([blankRow(defaultChain(asset)), blankRow(defaultChain(asset))]); }} />
        ) : (
          <>
            {/* Stablecoin selector — pay the whole batch in USDC or USDT. */}
            <div className={`inline-flex p-1 rounded-full border ${tc.cardBorder} ${tc.card} mb-4`}>
              {(['USDC', 'USDT'] as Asset[]).map((a) => (
                <button key={a} onClick={() => switchAsset(a)}
                  className={`px-5 py-1.5 rounded-full text-sm font-semibold transition ${
                    asset === a ? 'bg-[#C7FF00] text-black' : `${tc.textMuted}`
                  }`}>
                  {a}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-3.5`}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted}`}>Recipient {i + 1}</span>
                    <button onClick={() => removeRow(i)} aria-label="Remove" className={`p-1.5 rounded-lg ${tc.hoverBg}`}>
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input value={r.label} onChange={(e) => update(i, { label: e.target.value })}
                      placeholder="Name / label (optional)"
                      className={`col-span-1 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} outline-none`} />
                    <select value={r.chain} onChange={(e) => update(i, { chain: e.target.value })}
                      className={`col-span-1 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} outline-none`}>
                      {CHAINS_BY_ASSET[asset].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <input value={r.address} onChange={(e) => update(i, { address: e.target.value })}
                    placeholder={`${asset} wallet address`}
                    className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} outline-none mb-2 font-mono`} />
                  <div className="relative">
                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${tc.textMuted}`}>$</span>
                    <input value={r.amount} onChange={(e) => update(i, { amount: e.target.value.replace(/[^0-9.]/g, '') })}
                      inputMode="decimal" placeholder="0.00"
                      className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} pl-7 pr-3 py-2.5 text-sm ${tc.text} outline-none`} />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addRow}
              className={`mt-3 w-full py-3 rounded-2xl border border-dashed ${tc.cardBorder} ${tc.textSecondary} text-sm font-medium inline-flex items-center justify-center gap-2 ${tc.hoverBg}`}>
              <Plus className="w-4 h-4" /> Add recipient
            </button>

            <div className={`mt-5 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 flex items-center justify-between`}>
              <div>
                <div className={`text-[11px] uppercase tracking-wider ${tc.textMuted}`}>{valid.length} recipient{valid.length === 1 ? '' : 's'}</div>
                <div className={`text-2xl font-bold ${tc.text}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  ${total.toFixed(2)}
                </div>
              </div>
              <button onClick={submit} disabled={submitting || valid.length === 0}
                className="px-6 py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition disabled:opacity-50 inline-flex items-center gap-2">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Send payouts'}
              </button>
            </div>
            <p className={`mt-3 text-[11px] ${tc.textMuted} text-center`}>
              Stablecoin transfers are irreversible. Verify every address before sending.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ResultsView({ data, tc, onDone, onAnother }: {
  data: { summary: { total: number; submitted: number; failed: number; total_amount: number; currency: string };
    results: Array<{ row: number; label: string | null; state: string; error?: string }> };
  tc: any; onDone: () => void; onAnother: () => void;
}) {
  const { summary } = data;
  return (
    <div>
      <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-5 mb-4 text-center`}>
        <div className={`text-3xl font-bold ${tc.text}`}>{summary.submitted}/{summary.total}</div>
        <div className={`text-sm ${tc.textMuted} mt-1`}>
          submitted · ${summary.total_amount.toFixed(2)} {summary.currency}
          {summary.failed > 0 && <span className="text-red-400"> · {summary.failed} failed</span>}
        </div>
      </div>
      <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden mb-5`}>
        {data.results.map((r, i) => {
          const ok = r.state === 'succeeded' || r.state === 'pending';
          return (
            <div key={i} className={`px-4 py-3 flex items-center gap-3 ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}>
              {ok ? <CheckCircle2 className="w-4 h-4 text-[#C7FF00] flex-shrink-0" />
                  : <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${tc.text} truncate`}>{r.label || `Recipient ${r.row}`}</div>
                {!ok && r.error && <div className="text-[11px] text-red-400 truncate">{r.error}</div>}
              </div>
              <span className={`text-[11px] font-medium ${ok ? tc.textMuted : 'text-red-400'}`}>{r.state}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={onAnother} className={`flex-1 py-3 rounded-full border ${tc.cardBorder} ${tc.text} font-semibold text-sm`}>
          New batch
        </button>
        <button onClick={onDone} className="flex-1 py-3 rounded-full bg-[#C7FF00] text-black font-semibold text-sm">
          Done
        </button>
      </div>
    </div>
  );
}

export default BulkPayoutScreen;
