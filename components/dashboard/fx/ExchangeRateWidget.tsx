/**
 * ExchangeRateWidget — small, scannable FX card for the Home dashboard.
 *
 * Pulled from backendAPI.fx.getLiveRates, which now fetches REAL live
 * mid-market rates (ExchangeRate-API open feed). With PARTNER_FX_MARKUP
 * suspended, the customer-facing rate equals the true mid-market price.
 *
 * Shows:
 *   • Currently selected pair (default USD → NGN)
 *   • Live "updated" timestamp from the feed
 *   • Tiny SVG sparkline + % change built from REAL sampled rate history
 *     (persisted locally; fills in as the live feed moves — no fabrication)
 *   • "Convert" primary CTA → routes to /exchange
 *   • Tap a chip to switch pair without leaving the dashboard
 *
 * African currencies (NGN/KES/GHS/UGX/XOF/etc.) show real rates but remain
 * display-only — actual convert/payout for those rails is gated until our
 * African local rails are wired (the Exchange screen surfaces a
 * "Convert launching soon" notice today). If the live feed is unreachable
 * the widget falls back to an indicative snapshot and labels it as such.
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
  rate:    number;        // customer-facing (= mid; markup suspended)
  midRate: number;        // live mid-market rate
  change:  number;        // real % move since the previous sampled rate
  spark:   number[];      // real sampled rate history
}

// Real rate history, persisted locally so the change % and sparkline reflect
// ACTUAL sampled movement across loads (no fabricated data). We keep the last
// few distinct mid-rates per pair; the series fills in as the live feed moves.
const FX_HIST_KEY = 'borderpay_fx_hist_v1';
const FX_HIST_MAX = 24;

function readHist(): Record<string, number[]> {
  try {
    const v = JSON.parse(localStorage.getItem(FX_HIST_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}
function writeHist(h: Record<string, number[]>): void {
  try { localStorage.setItem(FX_HIST_KEY, JSON.stringify(h)); } catch { /* quota / private mode */ }
}

const DEFAULT_PAIR = 'USD_EUR';

export function ExchangeRateWidget({ onNavigate }: ExchangeRateWidgetProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [selected, setSelected] = useState<string>(DEFAULT_PAIR);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
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
        const hist = readHist();
        const rows: PairRow[] = Object.entries(r.data.rates).map(([pair, midRate]) => {
          const [base, quote] = pair.split('_');
          const mid = Number(midRate);
          const arr = Array.isArray(hist[pair]) ? hist[pair] : [];
          const prev = arr.length ? arr[arr.length - 1] : null;
          // Real movement since the last sampled rate (0 on first ever sample).
          const change = prev != null && prev > 0 ? ((mid - prev) / prev) * 100 : 0;
          // Append only when the rate actually moved, so the series is real
          // and doesn't spam identical points across same-day refreshes.
          const nextArr = prev == null || mid !== prev ? [...arr, mid].slice(-FX_HIST_MAX) : arr;
          hist[pair] = nextArr;
          return {
            pair, base, quote,
            midRate: mid,
            rate:    withMarkup(mid),
            change,
            spark:   nextArr.map((v) => withMarkup(v)),
          };
        });
        writeHist(hist);
        // Stable order: USD first, then alphabetical
        rows.sort((a, b) =>
          (a.base === 'USD' ? 0 : 1) - (b.base === 'USD' ? 0 : 1) ||
          a.pair.localeCompare(b.pair));
        setPairs(rows);
        setIsLive(r.data.source === 'live');
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
                : isLive
                  ? 'Live mid-market rate · no FX markup'
                  : 'Indicative rate · live feed unavailable'}
              {updatedAt && ' · updated ' + new Date(updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
  // With a single real sample we can't draw a trend yet — render a flat
  // baseline rather than fabricating motion. The line fills in as the live
  // feed moves and we collect more samples.
  const series = data.length === 1 ? [data[0], data[0]] : data;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min || 1;
  const step = width / (series.length - 1);
  const points = series.map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(2)}`).join(' ');
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
