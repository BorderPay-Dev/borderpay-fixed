/**
 * ExchangeRateWidget — Wise / Payoneer-style FX converter for the Home dashboard.
 *
 * A clean calculator: enter an amount in one currency, pick currencies, and see
 * the converted amount at the live mid-market rate (no FX markup). Wired to
 * backendAPI.fx.getLiveRates (real mid-market feed; falls back to an indicative
 * snapshot, clearly labelled, when the feed is unreachable).
 *
 * Multi-currency only: USD / EUR / GBP accounts + USDT / USDC stablecoins
 * (stablecoins convert 1:1 with USD). The "Convert" CTA routes to /exchange.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, ChevronDown, ArrowUpDown, ArrowRight } from 'lucide-react';
import { backendAPI } from '../../../utils/api/backendAPI';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';

interface ExchangeRateWidgetProps {
  onNavigate: (screen: string) => void;
}

interface Ccy { code: string; flag: string; sym: string }

const CURRENCIES: Ccy[] = [
  { code: 'USD',  flag: '🇺🇸', sym: '$' },
  { code: 'EUR',  flag: '🇪🇺', sym: '€' },
  { code: 'GBP',  flag: '🇬🇧', sym: '£' },
  { code: 'USDT', flag: '💵', sym: '₮' },
  { code: 'USDC', flag: '💵', sym: '$' },
];
const STABLE = new Set(['USDT', 'USDC']);
const META = (code: string): Ccy => CURRENCIES.find(c => c.code === code) || CURRENCIES[0];

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ExchangeRateWidget({ onNavigate }: ExchangeRateWidgetProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  // mid[`USD_EUR`] = how many EUR per 1 USD (mid-market).
  const [mid, setMid] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [openMenu, setOpenMenu] = useState<'from' | 'to' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const prefetchExchange = () => {
    if (typeof window !== 'undefined') (window as any).__borderpay_prefetch?.('exchange');
  };

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await backendAPI.fx.getLiveRates();
      if (r?.success && r.data?.rates) {
        setMid(r.data.rates as Record<string, number>);
        setIsLive(r.data.source === 'live');
        setUpdatedAt(r.data.generated_at || new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Close the currency menu on outside click.
  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openMenu]);

  // from → USD multiplier and USD → to multiplier, derived from the USD-based feed.
  const convert = (value: number, f: string, tg: string): number | null => {
    if (f === tg) return value;
    const fToUsd = (f === 'USD' || STABLE.has(f)) ? 1 : (mid[`USD_${f}`] ? 1 / mid[`USD_${f}`] : null);
    const usdToT = (tg === 'USD' || STABLE.has(tg)) ? 1 : (mid[`USD_${tg}`] ?? null);
    if (fToUsd == null || usdToT == null) return null;
    return value * fToUsd * usdToT;
  };

  const numAmount = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [amount]);

  const unitRate = useMemo(() => convert(1, from, to), [mid, from, to]);
  const converted = useMemo(() => convert(numAmount, from, to), [mid, from, to, numAmount]);

  const swap = () => { setFrom(to); setTo(from); };

  return (
    <section className="px-4 sm:px-5 mt-7" ref={rootRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>
          {tt('dashboard.convert', 'Convert')}
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
        className={`relative rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}
      >
        {/* You convert */}
        <ConvertRow
          label={tt('fx.youConvert', 'You convert')}
          value={amount}
          editable
          onChange={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
          ccy={from}
          menuOpen={openMenu === 'from'}
          onToggleMenu={() => setOpenMenu(openMenu === 'from' ? null : 'from')}
          onPick={(c) => { setFrom(c); setOpenMenu(null); }}
          disabledCode={to}
          tc={tc}
        />

        {/* Rate divider + swap */}
        <div className={`relative flex items-center px-4 py-2 border-y ${tc.borderLight}`}>
          <button
            type="button"
            onClick={swap}
            aria-label="Swap currencies"
            className="absolute -top-4 left-4 w-8 h-8 rounded-full bg-[#C7FF00] text-black flex items-center justify-center shadow-lg hover:brightness-95 active:scale-95 transition"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
          <p className={`ml-12 text-[11px] ${tc.textMuted}`}>
            {unitRate != null
              ? <>1 {from} = <span className={`font-semibold ${tc.text}`}>{fmtAmount(unitRate)} {to}</span></>
              : tt('fx.noRate', 'Rate unavailable')}
          </p>
        </div>

        {/* Recipient gets */}
        <ConvertRow
          label={tt('fx.youGet', 'You get')}
          value={converted != null ? fmtAmount(converted) : '—'}
          ccy={to}
          menuOpen={openMenu === 'to'}
          onToggleMenu={() => setOpenMenu(openMenu === 'to' ? null : 'to')}
          onPick={(c) => { setTo(c); setOpenMenu(null); }}
          disabledCode={from}
          tc={tc}
          emphasis
        />

        {/* Rate provenance */}
        <p className={`px-4 pb-3 -mt-1 text-[10px] ${tc.textMuted}`}>
          {isLive ? tt('fx.live', 'Live mid-market rate · no FX markup') : tt('fx.indicative', 'Indicative rate · live feed unavailable')}
          {updatedAt && ' · ' + new Date(updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>

        {/* CTA */}
        <button
          onPointerDown={prefetchExchange}
          onMouseEnter={prefetchExchange}
          onClick={() => onNavigate('exchange')}
          className="w-full px-4 py-3 border-t border-transparent flex items-center justify-center gap-2 bg-[#C7FF00] text-black text-[13px] font-bold hover:brightness-95 transition"
        >
          {tt('dashboard.convertCurrencies', 'Convert')}
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </section>
  );
}

// ── Convert row (amount + currency selector) ──────────────────────────────
function ConvertRow({
  label, value, editable, onChange, ccy, menuOpen, onToggleMenu, onPick, disabledCode, tc, emphasis,
}: {
  label: string;
  value: string;
  editable?: boolean;
  onChange?: (v: string) => void;
  ccy: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPick: (code: string) => void;
  disabledCode: string;
  tc: ReturnType<typeof useThemeClasses>;
  emphasis?: boolean;
}) {
  const m = META(ccy);
  return (
    <div className="relative px-4 py-3.5">
      <p className={`text-[11px] font-medium ${tc.textMuted} mb-1.5`}>{label}</p>
      <div className="flex items-center gap-3">
        {editable ? (
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={`flex-1 min-w-0 bg-transparent outline-none tabular-nums ${emphasis ? 'text-[26px]' : 'text-[26px]'} font-semibold ${tc.text}`}
            placeholder="0.00"
          />
        ) : (
          <p className={`flex-1 min-w-0 tabular-nums text-[26px] font-semibold ${emphasis ? 'text-[#C7FF00]' : tc.text} truncate`}>
            {value}
          </p>
        )}

        {/* Currency selector */}
        <button
          type="button"
          onClick={onToggleMenu}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border ${tc.cardBorder} ${tc.bgAlt} ${tc.hoverBg} transition`}
        >
          <span className="text-base leading-none">{m.flag}</span>
          <span className={`text-sm font-bold ${tc.text}`}>{m.code}</span>
          <ChevronDown className={`w-3.5 h-3.5 ${tc.textMuted} transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {menuOpen && (
        <div className={`absolute right-4 top-[68px] z-20 w-40 rounded-xl border ${tc.cardBorder} ${tc.card} shadow-2xl overflow-hidden`}>
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              disabled={c.code === disabledCode}
              onClick={() => onPick(c.code)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition ${
                c.code === ccy ? 'bg-[#C7FF00]/10' : tc.hoverBg
              } ${c.code === disabledCode ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              <span className="text-base leading-none">{c.flag}</span>
              <span className={`text-sm font-semibold ${tc.text}`}>{c.code}</span>
              {c.code === ccy && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#C7FF00]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExchangeRateWidget;
