import React, { useEffect } from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { ExchangeRateWidget } from '../dashboard/fx/ExchangeRateWidget';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface ExchangeScreenProps {
  onBack: () => void;
}

/**
 * Legacy route component retained only as a non-executable reference surface.
 * MainApp redirects stale `exchange` routes to the dashboard. There is no
 * amount entry, quote, wallet selection, orchestration, or transfer action.
 */
export function ExchangeScreen({ onBack }: ExchangeScreenProps) {
  const tc = useThemeClasses();

  useEffect(() => {
    navPerfTrackCache('exchange', true);
  }, []);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <main className="mx-auto max-w-2xl pb-28 pt-floating-back">
        <header className="px-4 sm:px-5">
          <h1 className={`text-xl font-bold ${tc.text}`}>Indicative rates</h1>
          <p className={`mt-1 text-sm leading-5 ${tc.textMuted}`}>
            View reference rates for USD, EUR, and GBP to digital dollars. No conversion can be started here.
          </p>
        </header>
        <ExchangeRateWidget />
      </main>
    </div>
  );
}

export default ExchangeScreen;
