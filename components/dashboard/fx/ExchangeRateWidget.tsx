/**
 * ExchangeRateWidget — small, scannable FX card for the Home dashboard.
 *
 * Pulled from backendAPI.fx.getLiveRates (currently indicative fallback rates
 * — a live rates feed will replace it without changing this UI). The
 * customer-facing rate is the partner mid-rate × (1 + PARTNER_FX_MARKUP)
 * so what we render is exactly what would land in the Convert flow.
 *
 * Shows:
 *   • Currently selected pair (default USD → NGN)
 *   • Last-updated timestamp
 *   • Tiny SVG sparkline of synthetic last-24h motion (deterministic per
 *     pair so it doesn't change on every render)
 *   • "Convert" primary CTA → routes to /exchange
 *   • Tap a chip to switch pair without leaving the dashboard
 *
 * African currencies (NGN/KES/GHS/UGX/XAF/etc.) are shown as indicative
 * rates only — actual convert/payout for those rails is gated until our
 * African local rails are wired (the Exchange screen surfaces a
 * "Convert launching soon" notice today).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeftRight, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { backendAPI } from '../../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';
import { PARTNER_FX_MARKUP, markupLabel, withMarkup } from '../../../utils/fx/markup';

interface ExchangeRateWidgetProps {
  /** Routes the Convert CTA to the in-app Exchange screen. */
  onNavigate: (screen: string) => void;
}

interface PairRow {
  pair:    string;        // 'USD_NGN'
  base:    string;
  quote:   string;
  rate:    number;        // customer-facing (with markup)
  midRate: number;        // partner mid-rate
  change:  number;        // synthetic 24h % move
  spark:   number[];      // synthetic spark series
}

// Deterministic pseudo-random so the sparkline doesn't change on re-render.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619 >>> 0;
  return h;
}
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function synthSpark(seed: string, base: number, vol: number, n = 24): number[] {
  const rng = mulberry32(hashSeed(seed));
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (rng() - 0.5) * vol;
    out.push(v);
  }
  return out;
}

const DEFAULT_PAIR = 'USD_NGN';

export function ExchangeRateWidget({ onNavigate }: ExchangeRateWidgetProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [selected, setSelected] = useState<string>(DEFAULT_PAIR);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prefetchExchange = () => {
    if (typeof window !== 'undefined') {
      (window as any).__borderpay_prefetch?.('exchange');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await backendAPI.fx.getLiveRates();
      if (r?.success && r.data?.rates) {
        const rows: PairRow[] = Object.entries(r.data.rates).map(([pair, midRate]) => {
          const [base, quote] = pair.split('_');
          const mid = Number(midRate);
          const seed = `${pair}-${Math.floor(Date.now() / 1000 / 3600)}`;
          const change = (mulberry32(hashSeed(seed))() - 0.5) * 2;  // -1..+1
          return {
            pair, base, quote,
            midRate: mid,
            rate:    withMarkup(mid),
            change,
            spark:   synthSpark(seed, withMarkup(mid), withMarkup(mid) * 0.005),
          };
        });
        // Stable order: USD first, then alphabetical
        rows.sort((a, b) =>
          (a.base === 'USD' ? 0 : 1) - (b.base === 'USD' ? 0 : 1) ||
          a.pair.localeCompare(b.pair));
        setPairs(rows);
        setUpdatedAt(r.data.generated_at || new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const current = useMemo(
    () => pairs.find(p => p.pair === selected) || pairs[0],
    [pairs, selected],
  );

  return (
    <section className="px-4 sm:px-5 mt-7">
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>
          {tt('dashboard.exchangeRates', 'Exchange rates')}
        </h3>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh rates"
          className={`p-1 rounded-full ${tc.hoverBg}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${tc.textMuted} ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}
      >
        {/* Selected-pair hero */}
        {current && (
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-baseline gap-2">
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${tc.textMuted}`}>
                1 {current.base}
              </p>
              <p className={`text-[10px] ${tc.textMuted}`}>≈</p>
              <p className={`text-[22px] font-semibold ${tc.text} tabular-nums font-mono leading-none`}>
                {current.rate.toFixed(current.rate >= 100 ? 2 : 4)}
              </p>
              <p className={`text-[12px] font-semibold ${tc.textSecondary}`}>{current.quote}</p>
              <span className={`ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold ${current.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {current.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {current.change >= 0 ? '+' : ''}{current.change.toFixed(2)}%
              </span>
            </div>
            <p className={`text-[10px] ${tc.textMuted} mt-1`}>
              {PARTNER_FX_MARKUP > 0
                ? `Includes ${markupLabel()} markup`
                : 'Real mid-market rate · no FX markup'}
              {updatedAt && ' · last updated ' + new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>

            {/* Live line graphic */}
            <Sparkline data={current.spark} positive={current.change >= 0} />
          </div>
        )}

        {/* Pair selector strip */}
        <div className={`px-4 pt-3 pb-3 border-t ${tc.borderLight} overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
          <div className="flex gap-1.5 min-w-min">
            {pairs.map((p) => {
              const active = p.pair === selected;
              return (
                <button
                  key={p.pair}
                  onClick={() => setSelected(p.pair)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono font-bold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#C7FF00] text-black border-[#C7FF00]'
                      : `${tc.card} ${tc.cardBorder} ${tc.text} ${tc.hoverBg}`
                  }`}
                >
                  {p.base}/{p.quote}
                </button>
              );
            })}
          </div>
        </div>

        {/* Convert CTA */}
        <button
          onPointerDown={prefetchExchange}
          onMouseEnter={prefetchExchange}
          onClick={() => onNavigate('exchange')}
          className={`w-full px-4 py-3 border-t ${tc.borderLight} flex items-center justify-center gap-2 bg-[#C7FF00] text-black text-[12px] font-bold hover:brightness-95 transition`}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          {tt('dashboard.convertCurrencies', 'Convert currencies')}
        </button>
      </motion.div>
    </section>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length) return null;
  const width = 320, height = 36;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(2)}`).join(' ');
  const stroke = positive ? '#34D399' : '#F87171';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-3 w-full h-9">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default ExchangeRateWidget;
