/**
 * TreasuryCard — business treasury management at a glance.
 *
 * Shows the USD-equivalent treasury balance, a 30-day balance-trend area chart
 * reconstructed from the real transaction ledger (current balance walked back
 * by signed credits/debits — no fabricated data), the 30-day % change, and a
 * per-currency breakdown of holdings.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Landmark } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface WalletRow { currency: string; balance: number }

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', USDT: '$', USDC: '$' };

// Reconstruct a 30-day USD-equivalent balance series ending at the current
// total: balance(t) = currentTotal − Σ(signed flows after t). Real ledger data.
function buildSeries(txs: any[], currentTotal: number): number[] {
  const now = Date.now();
  const DAYS = 30, POINTS = 12;
  const completed = txs.filter((t: any) => !t.status || t.status === 'completed');
  const signed = (t: any) => (t.type === 'credit' ? 1 : -1) * Number(t.amount || 0);
  const out: number[] = [];
  for (let i = POINTS - 1; i >= 0; i--) {
    const cutoff = now - (i * (DAYS / POINTS) * 86_400_000);
    const after = completed
      .filter((t: any) => new Date(t.created_at).getTime() > cutoff)
      .reduce((s: number, t: any) => s + signed(t), 0);
    out.push(Math.max(0, currentTotal - after));
  }
  return out;
}

export function TreasuryCard({ totalUsd, wallets }: { totalUsd: number; wallets: WalletRow[] }) {
  const tc = useThemeClasses();
  const [series, setSeries] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r: any = await backendAPI.transactions.getTransactions(90);
        if (!alive) return;
        setSeries(buildSeries(r?.data?.transactions || [], totalUsd));
      } catch {
        if (alive) setSeries([totalUsd, totalUsd]);
      }
    })();
    return () => { alive = false; };
  }, [totalUsd]);

  const change = useMemo(() => {
    if (series.length < 2 || !series[0]) return 0;
    return ((series[series.length - 1] - series[0]) / Math.abs(series[0])) * 100;
  }, [series]);

  const breakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const w of wallets) map[w.currency] = (map[w.currency] || 0) + (w.balance || 0);
    return Object.entries(map).filter(([, v]) => v > 0);
  }, [wallets]);

  const [whole, cents] = totalUsd.toFixed(2).split('.');

  return (
    <section className="px-5 sm:px-6">
      <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
        <div className="p-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#C7FF00]/15 flex items-center justify-center">
                <Landmark className="w-4 h-4 text-[#C7FF00]" />
              </div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${tc.textMuted}`}>Treasury balance</p>
            </div>
            <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {change >= 0 ? '+' : ''}{change.toFixed(1)}% · 30d
            </span>
          </div>
          <p className={`${tc.text} font-semibold tracking-tight tabular-nums leading-none text-[34px]`}>
            <span className={`text-xl ${tc.textMuted} mr-1 align-top`}>$</span>{whole}
            <span className={`text-xl ${tc.textMuted}`}>.{cents}</span>
          </p>
        </div>

        <TreasuryChart data={series.length ? series : [totalUsd, totalUsd]} positive={change >= 0} />

        {breakdown.length > 0 && (
          <div className={`px-5 py-4 border-t ${tc.borderLight} flex flex-wrap gap-2`}>
            {breakdown.map(([code, amt]) => (
              <span key={code} className={`inline-flex items-center gap-1.5 rounded-full border ${tc.borderLight} ${tc.bgAlt} px-3 py-1 text-[11px]`}>
                <span className={`font-bold ${tc.text}`}>{code}</span>
                <span className={tc.textMuted}>{SYMBOL[code] || ''}{amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TreasuryChart({ data, positive }: { data: number[]; positive: boolean }) {
  const W = 600, H = 120;
  const series = data.length < 2 ? [data[0] || 0, data[0] || 0] : data;
  const min = Math.min(...series), max = Math.max(...series), range = max - min || 1;
  const step = W / (series.length - 1);
  const pts = series.map((v, i) => [i * step, H - ((v - min) / range) * (H - 16) - 8] as const);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const stroke = positive ? '#C7FF00' : '#F87171';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-28">
      <defs>
        <linearGradient id="treasGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#treasGrad)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default TreasuryCard;
