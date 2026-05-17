/**
 * ExchangeScreen — indicative FX rates + coming-soon convert.
 *
 * Currency convert (fiat ↔ fiat and fiat ↔ stablecoin) routes through the
 * partner's transfer endpoint in a future release; the previous screen
 * called a retired `fx` edge function and would have 404'd on every Swap.
 * Until the new convert path lands, this screen surfaces:
 *
 *   1. Live FX rates (indicative; sourced from `backendAPI.fx.getLiveRates`)
 *   2. A clear "Conversion launching soon" note so users don't expect to
 *      execute a swap that will fail.
 *
 * AppShell owns the top chrome; renders body-only.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeftRight, RefreshCw, Sparkles } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { backendAPI } from '../../utils/api/backendAPI';

interface ExchangeScreenProps {
  onBack: () => void;
  preSelectedWalletId?: string;
}

interface RateRow {
  pair:    string;
  base:    string;
  quote:   string;
  rate:    number;
  source:  'live' | 'fallback';
}

function fmtPair(pair: string): { base: string; quote: string } {
  const [base, quote] = pair.split('_');
  return { base: base || '?', quote: quote || '?' };
}

export function ExchangeScreen({ onBack }: ExchangeScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  const [rates, setRates]       = useState<RateRow[]>([]);
  const [source, setSource]     = useState<'live' | 'fallback'>('fallback');
  const [generated, setGenerated] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  const loadRates = async () => {
    setLoading(true);
    try {
      const r: any = await backendAPI.fx.getLiveRates();
      if (r?.success && r.data) {
        const ratesObj: Record<string, number> = r.data.rates || {};
        const rows: RateRow[] = Object.entries(ratesObj).map(([pair, rate]) => {
          const { base, quote } = fmtPair(pair);
          return { pair, base, quote, rate: Number(rate), source: r.data.source ?? 'fallback' };
        });
        setRates(rows);
        setSource(r.data.source ?? 'fallback');
        setGenerated(r.data.generated_at ?? null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRates(); }, []);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        <div className="flex items-center justify-between mb-4">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted}`}>
            {tt('exchange.title', 'Exchange')}
          </p>
          <button
            onClick={loadRates}
            aria-label="Refresh rates"
            className={`p-1.5 rounded-full ${tc.hoverBg} transition-colors`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${tc.textMuted} ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Coming-soon convert hero — replaces the old Swap form that would
            have called a retired `fx` edge function. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#15191F] via-[#0F1216] to-[#0B0E11] px-5 py-6 mb-6"
        >
          <div className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-[#C7FF00] opacity-[0.08] blur-3xl" />
          <div className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#C7FF00]/15 mb-3">
            <Sparkles className="w-3 h-3 text-[#C7FF00]" />
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#C7FF00]">In the works</span>
          </div>
          <h1 className="relative text-white font-semibold tracking-tight text-2xl sm:text-3xl mb-2">
            Convert your balances
          </h1>
          <p className="relative text-sm text-white/60 max-w-md leading-relaxed">
            One-tap convert across your USD / EUR / GBP accounts and stablecoin
            wallets is launching with the next release. Today, you can move
            funds via the Send and Receive flows.
          </p>
        </motion.div>

        {/* Live rates */}
        <h2 className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2.5 px-1`}>
          {tt('exchange.rates', 'Rates')}
        </h2>
        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          {loading ? (
            <div className="px-4 py-10 flex justify-center">
              <RefreshCw className={`w-4 h-4 ${tc.textMuted} animate-spin`} />
            </div>
          ) : rates.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className={`text-sm ${tc.textMuted}`}>No rates available right now.</p>
            </div>
          ) : (
            rates.map((r, i) => (
              <div
                key={r.pair}
                className={`px-4 py-3.5 flex items-center justify-between ${i > 0 ? `border-t ${tc.borderLight}` : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center`}>
                    <ArrowLeftRight className={`w-4 h-4 ${tc.text}`} />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${tc.text}`}>{r.base} / {r.quote}</p>
                    <p className={`text-[10px] ${tc.textMuted}`}>1 {r.base}</p>
                  </div>
                </div>
                <p className={`text-sm font-semibold tabular-nums font-mono ${tc.text}`}>
                  {r.rate.toFixed(r.rate >= 100 ? 2 : 4)} {r.quote}
                </p>
              </div>
            ))
          )}
        </div>

        <p className={`text-[10px] ${tc.textMuted} mt-3 px-1 leading-snug`}>
          {source === 'fallback'
            ? 'Indicative rates. A live rates feed will be wired in a future release.'
            : 'Live indicative rates.'}
          {generated && ' · '}
          {generated && new Date(generated).toLocaleString()}
        </p>

        <button
          onClick={onBack}
          className={`mt-6 text-[11px] font-semibold ${tc.textMuted} hover:${tc.text}`}
        >
          Back
        </button>
      </div>
    </div>
  );
}

export default ExchangeScreen;
