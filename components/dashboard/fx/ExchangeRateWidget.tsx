import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { backendAPI } from '../../../utils/api/backendAPI';
import { useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';

const DISPLAY_PAIRS = [
  ['USD', 'USDC'],
  ['USD', 'USDT'],
  ['EUR', 'USDC'],
  ['EUR', 'USDT'],
  ['GBP', 'USDC'],
  ['GBP', 'USDT'],
] as const;

type DisplayPair = (typeof DISPLAY_PAIRS)[number];
type RateState = Record<string, { rate: number; updatedAt: string | null } | null>;

const pairKey = ([from, to]: DisplayPair) => `${from}_${to}`;

function formatRate(rate: number): string {
  return rate.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Read-only Bridge reference rates. This component deliberately has no amount
 * input, currency picker, conversion CTA, navigation, or fallback rates.
 * The rate actually applied to a completed transaction remains the value from
 * that transaction's Bridge receipt/webhook and is shown on its receipt/email.
 */
export function ExchangeRateWidget() {
  const tc = useThemeClasses();
  const [rates, setRates] = useState<RateState>({});
  const [loading, setLoading] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response: any = await backendAPI.fx.getReferenceRates();
      const rows = response?.success && Array.isArray(response?.data?.rates) ? response.data.rates : [];
      const confirmed: RateState = {};
      for (const row of rows) {
        const key = `${String(row?.from || '').toUpperCase()}_${String(row?.to || '').toUpperCase()}`;
        const rate = Number(row?.rate);
        if (DISPLAY_PAIRS.some((pair) => pairKey(pair) === key) && Number.isFinite(rate) && rate > 0) {
          confirmed[key] = { rate, updatedAt: row?.updated_at || null };
        }
      }
      if (Object.keys(confirmed).length > 0) {
        // A partial or failed refresh must not replace a previously confirmed
        // Bridge rate with a missing state. Never manufacture a fallback.
        setRates((current) => ({ ...current, ...confirmed }));
        setLastCheckedAt(new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const visiblePairs = DISPLAY_PAIRS.filter((pair) => rates[pairKey(pair)]);
  if (visiblePairs.length === 0) return null;

  return (
    <section className="px-4 sm:px-5 mt-7" aria-labelledby="reference-rates-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="reference-rates-heading" className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-[0.14em]`}>
            Reference rates
          </h3>
          <p className={`mt-1 text-[11px] ${tc.textMuted}`}>View only · rates update regularly</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh reference rates"
          className={`flex h-11 w-11 items-center justify-center rounded-full ${tc.hoverBg} disabled:opacity-50`}
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${tc.textMuted} ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className={`overflow-hidden rounded-2xl border ${tc.cardBorder} ${tc.card}`}>
        <div className="grid grid-cols-2 gap-px" role="list" aria-label="Digital dollar reference rates">
          {visiblePairs.map((pair) => {
            const [from, to] = pair;
            const item = rates[pairKey(pair)];
            return (
              <div key={pairKey(pair)} role="listitem" className={`min-w-0 px-4 py-3.5 ${tc.bgAlt}`}>
                <p className={`text-[11px] font-semibold ${tc.textSecondary}`}>{from}/{to}</p>
                <p className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${tc.text}`}>
                  {item ? formatRate(item.rate) : null}
                </p>
              </div>
            );
          })}
        </div>
        <p className={`border-t px-4 py-3 text-[10px] leading-4 ${tc.cardBorder} ${tc.textMuted}`}>
          Rates are informational and may change. Your completed transaction receipt shows the rate applied.
          {lastCheckedAt ? ` Last checked ${new Date(lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}
        </p>
      </div>
    </section>
  );
}

export default ExchangeRateWidget;
