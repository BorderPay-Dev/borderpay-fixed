/**
 * TreasuryCard — Mercury-style treasury management.
 *
 * Big balance that updates as you scrub the chart, period tabs
 * (1W / 1M / 3M / 6M / 1Y), a smooth balance-trend area line, an interactive
 * crosshair + tooltip, and a per-currency breakdown. The series is the
 * USD-equivalent balance reconstructed from the real transaction ledger
 * (current balance walked back by signed credits/debits — no fabricated data).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Landmark } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { txDirection } from '../../utils/transactions/direction';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface WalletRow { currency: string; balance: number }

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', USDT: '$', USDC: '$' };

type Period = '1W' | '1M' | '3M' | '6M' | '1Y';
const PERIODS: { key: Period; days: number; points: number }[] = [
  { key: '1W', days: 7,   points: 7  },
  { key: '1M', days: 30,  points: 15 },
  { key: '3M', days: 90,  points: 18 },
  { key: '6M', days: 180, points: 24 },
  { key: '1Y', days: 365, points: 26 },
];

const DAY = 86_400_000;
const signed = (t: any) => (txDirection(t) === 'credit' ? 1 : -1) * Number(t.amount || 0);

// balance(t) = currentTotal − Σ(signed flows after t). Real ledger reconstruction.
function buildSeries(txs: any[], currentTotal: number, days: number, points: number): { values: number[]; times: number[] } {
  const now = Date.now();
  const completed = txs.filter((t: any) => !t.status || t.status === 'completed');
  const values: number[] = [];
  const times: number[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = now - (i * (days / points) * DAY);
    const after = completed
      .filter((tx: any) => new Date(tx.created_at).getTime() > t)
      .reduce((s: number, tx: any) => s + signed(tx), 0);
    values.push(Math.max(0, currentTotal - after));
    times.push(t);
  }
  return { values, times };
}

const TREASURY_TX_KEY = 'borderpay_treasury_tx_v1';
function readTreasuryTx(): any[] {
  try { const raw = localStorage.getItem(TREASURY_TX_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

export function TreasuryCard({
  totalUsd,
  wallets,
  transactions,
}: {
  totalUsd: number;
  wallets: WalletRow[];
  transactions?: any[];
  userId?: string;
}) {
  const tc = useThemeClasses();
  // Seed the series from cache so the curve is stable/instant on revisit.
  const [txs, setTxs] = useState<any[]>(() => transactions ?? readTreasuryTx());
  const [period, setPeriod] = useState<Period>('1M');
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r: any = await backendAPI.financial.getSnapshot(250);
        const list = Array.isArray(r?.data?.recent_transactions) ? r.data.recent_transactions : [];
        if (alive) {
          setTxs(list);
          try { localStorage.setItem(TREASURY_TX_KEY, JSON.stringify(list)); } catch { /* noop */ }
        }
      } catch { /* keep cached/flat fallback */ }
    })();
    return () => { alive = false; };
  }, []);

  const cfg = PERIODS.find(p => p.key === period)!;
  const { values, times } = useMemo(
    () => buildSeries(txs, totalUsd, cfg.days, cfg.points),
    [txs, totalUsd, cfg.days, cfg.points],
  );

  const change = useMemo(() => {
    if (values.length < 2 || !values[0]) return 0;
    return ((values[values.length - 1] - values[0]) / Math.abs(values[0])) * 100;
  }, [values]);

  const breakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const w of wallets) map[w.currency] = (map[w.currency] || 0) + (w.balance || 0);
    return Object.entries(map).filter(([, v]) => v > 0);
  }, [wallets]);

  const shownValue = hover != null && values[hover] != null ? values[hover] : totalUsd;
  const [whole, cents] = shownValue.toFixed(2).split('.');
  const shownLabel = hover != null && times[hover] != null
    ? new Date(times[hover]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : `Today · ${period}`;

  const onMove = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || values.length < 2) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (values.length - 1)));
  };

  return (
    <section className="px-5 sm:px-6">
      <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
        {/* Header: label + balance + change */}
        <div className="p-5 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-[#C7FF00]/15 flex items-center justify-center">
              <Landmark className="w-3.5 h-3.5 text-[#C7FF00]" />
            </div>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${tc.textMuted}`}>Treasury</p>
          </div>
          <p className={`${tc.text} font-semibold tracking-tight tabular-nums leading-none text-[34px]`}>
            <span className={`text-xl ${tc.textMuted} mr-1 align-top`}>$</span>{whole}
            <span className={`text-xl ${tc.textMuted}`}>.{cents}</span>
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {change >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
            <span className={`text-[12px] ${tc.textMuted}`}>{shownLabel}</span>
          </div>
        </div>

        {/* Chart */}
        <div
          ref={wrapRef}
          className="relative px-1 select-none"
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0].clientX)}
          onTouchMove={(e) => onMove(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          <TreasuryChart values={values} positive={change >= 0} hover={hover} />
        </div>

        {/* Period tabs */}
        <div className="px-4 pb-3 flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => { setPeriod(p.key); setHover(null); }}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                period === p.key ? 'bg-[#C7FF00] text-black' : `${tc.textMuted} ${tc.hoverBg}`
              }`}
            >
              {p.key}
            </button>
          ))}
        </div>

        {/* Currency breakdown */}
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

// Catmull-Rom → cubic-bezier smoothing for a Mercury-style smooth curve.
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 >= pts.length ? pts.length - 1 : i + 2];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function TreasuryChart({ values, positive, hover }: { values: number[]; positive: boolean; hover: number | null }) {
  const W = 600, H = 150, PAD = 10;
  const series = values.length < 2 ? [values[0] || 0, values[0] || 0] : values;
  const min = Math.min(...series), max = Math.max(...series), range = max - min || 1;
  const step = W / (series.length - 1);
  const pts: [number, number][] = series.map((v, i) => [i * step, H - PAD - ((v - min) / range) * (H - PAD * 2)]);
  const line = smoothPath(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const stroke = positive ? '#C7FF00' : '#F87171';
  const hx = hover != null ? pts[hover]?.[0] : null;
  const hy = hover != null ? pts[hover]?.[1] : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-36 block">
      <defs>
        <linearGradient id="treasGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#treasGrad)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {hx != null && hy != null && (
        <>
          <line x1={hx} y1={0} x2={hx} y2={H} stroke={stroke} strokeWidth="1" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
          <circle cx={hx} cy={hy} r="4" fill={stroke} stroke="#0B0E11" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

export default TreasuryCard;
