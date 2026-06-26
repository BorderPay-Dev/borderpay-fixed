import React, { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Trash2, ArrowRight } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

type PayrollAsset = 'USDC' | 'USDT';
interface EmployeeRow {
  name: string;
  chain: string;
  address: string;
  amount: string;
}

const CHAINS_BY_ASSET: Record<PayrollAsset, string[]> = {
  USDC: ['solana', 'ethereum', 'base', 'polygon'],
  USDT: ['tron', 'ethereum', 'solana', 'polygon'],
};

const prefillKey = 'borderpay_bulk_prefill_v1';
const prefetch = (screen: string) => {
  try { (window as any).__borderpay_prefetch?.(screen); } catch { /* noop */ }
};

function blank(asset: PayrollAsset): EmployeeRow {
  return { name: '', chain: CHAINS_BY_ASSET[asset][0], address: '', amount: '' };
}

export function PayrollScreen({
  onBack,
  onOpenBulkPayout,
}: {
  onBack: () => void;
  onOpenBulkPayout: () => void;
}) {
  const tc = useThemeClasses();
  const [asset, setAsset] = useState<PayrollAsset>('USDC');
  const [rows, setRows] = useState<EmployeeRow[]>([blank('USDC'), blank('USDC')]);

  const valid = useMemo(
    () => rows.filter((r) => r.address.trim() && Number(r.amount) > 0),
    [rows],
  );
  const total = useMemo(
    () => valid.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [valid],
  );

  const setAssetWithRows = (next: PayrollAsset) => {
    setAsset(next);
    setRows((prev) => prev.map((r) => (
      CHAINS_BY_ASSET[next].includes(r.chain) ? r : { ...r, chain: CHAINS_BY_ASSET[next][0] }
    )));
  };

  const update = (idx: number, patch: Partial<EmployeeRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const add = () => setRows((prev) => [...prev, blank(asset)]);
  const remove = (idx: number) => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const openBulkPayout = () => {
    const items = valid.map((r) => ({
      label: r.name.trim() || undefined,
      chain: r.chain,
      address: r.address.trim(),
      amount: r.amount,
    }));
    prefetch('bulk-payout');
    try { localStorage.setItem(prefillKey, JSON.stringify({ asset, items })); } catch { /* ignore */ }
    window.setTimeout(onOpenBulkPayout, 0);
  };

  return (
    <div className={`min-h-screen ${tc.bg} pt-floating-back`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-5 pb-28">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-[#C7FF00]/15 flex items-center justify-center">
            <Users className="w-4.5 h-4.5 text-[#C7FF00]" />
          </div>
          <h1 className={`text-xl font-bold ${tc.text}`}>Payroll</h1>
        </div>
        <p className={`text-sm ${tc.textMuted} mb-5`}>
          Prepare employee payouts, then execute in the existing bulk payout engine.
        </p>

        <div className={`inline-flex p-1 rounded-full border ${tc.cardBorder} ${tc.card} mb-4`}>
          {(['USDC', 'USDT'] as PayrollAsset[]).map((a) => (
            <button
              key={a}
              onClick={() => setAssetWithRows(a)}
              className={`px-5 py-1.5 rounded-full text-sm font-semibold transition ${
                asset === a ? 'bg-[#C7FF00] text-black' : `${tc.textMuted}`
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className={`rounded-2xl border ${tc.cardBorder} ${tc.card} p-3.5`}>
              <div className="flex items-center justify-between mb-2.5">
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted}`}>Employee {i + 1}</span>
                <button onClick={() => remove(i)} aria-label="Remove" className={`p-1.5 rounded-lg ${tc.hoverBg}`}>
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Employee name"
                  className={`col-span-1 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} outline-none`}
                />
                <select
                  value={r.chain}
                  onChange={(e) => update(i, { chain: e.target.value })}
                  className={`col-span-1 rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} outline-none`}
                >
                  {CHAINS_BY_ASSET[asset].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <input
                value={r.address}
                onChange={(e) => update(i, { address: e.target.value })}
                placeholder={`${asset} wallet address`}
                className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} px-3 py-2.5 text-sm ${tc.text} outline-none mb-2 font-mono`}
              />
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${tc.textMuted}`}>$</span>
                <input
                  value={r.amount}
                  onChange={(e) => update(i, { amount: e.target.value.replace(/[^0-9.]/g, '') })}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`w-full rounded-xl ${tc.bgAlt} border ${tc.cardBorder} pl-7 pr-3 py-2.5 text-sm ${tc.text} outline-none`}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={add}
          className={`mt-3 w-full py-3 rounded-2xl border border-dashed ${tc.cardBorder} ${tc.textSecondary} text-sm font-medium inline-flex items-center justify-center gap-2 ${tc.hoverBg}`}
        >
          <Plus className="w-4 h-4" /> Add employee
        </button>

        <div className={`mt-5 rounded-2xl border ${tc.cardBorder} ${tc.card} p-4 flex items-center justify-between`}>
          <div>
            <div className={`text-[11px] uppercase tracking-wider ${tc.textMuted}`}>{valid.length} employee{valid.length === 1 ? '' : 's'}</div>
            <div className={`text-2xl font-bold ${tc.text}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
              ${total.toFixed(2)}
            </div>
          </div>
          <button
            onPointerDown={() => prefetch('bulk-payout')}
            onMouseEnter={() => prefetch('bulk-payout')}
            onClick={openBulkPayout}
            disabled={valid.length === 0}
            className="px-5 py-3 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition disabled:opacity-50 inline-flex items-center gap-2"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default PayrollScreen;
