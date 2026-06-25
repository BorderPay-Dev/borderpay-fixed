import React, { useEffect } from 'react';
import { BriefcaseBusiness, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface PayrollComingSoonScreenProps {
  onBack: () => void;
}

export function PayrollComingSoonScreen({ onBack }: PayrollComingSoonScreenProps) {
  const tc = useThemeClasses();

  useEffect(() => {
    navPerfTrackCache('payroll', true);
  }, []);

  return (
    <div className={`min-h-screen ${tc.bg} flex flex-col`}>
      <header className="flex items-center gap-3 px-5 sm:px-6 pt-safe-header pb-3">
        <button
          onClick={onBack}
          className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center ${tc.hoverBg}`}
          aria-label="Back"
        >
          <ArrowLeft className={`w-4 h-4 ${tc.text}`} />
        </button>
        <h1 className={`text-base font-semibold ${tc.text}`}>Payroll</h1>
      </header>

      <main className="flex-1 flex items-start justify-center px-5 sm:px-6 pt-8">
        <div className={`w-full max-w-md rounded-3xl border ${tc.cardBorder} ${tc.card} p-6 sm:p-8`}>
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#C7FF00] flex items-center justify-center mb-5">
              <BriefcaseBusiness className="w-7 h-7 text-black" strokeWidth={2} />
            </div>

            <h2 className={`text-xl font-bold ${tc.text} mb-2`}>
              Payroll coming soon
            </h2>

            <p className={`text-sm ${tc.textSecondary} leading-relaxed mb-5`}>
              Business payroll execution is not certified yet. You can continue
              using send and bulk payout flows where available.
            </p>

            <div className={`w-full rounded-2xl border ${tc.cardBorder} ${tc.bgAlt ?? 'bg-white/[0.03]'} p-4 text-left mb-5`}>
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <ShieldCheck className={`w-5 h-5 ${tc.text}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${tc.text} mb-1`}>
                    Certification gate active
                  </p>
                  <p className={`text-xs ${tc.textMuted} leading-relaxed`}>
                    Payroll will unlock after RC1 business parity certification is complete.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={onBack}
              className={`w-full py-3 rounded-2xl ${tc.card} border ${tc.cardBorder} ${tc.text} font-semibold text-sm ${tc.hoverBg}`}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default PayrollComingSoonScreen;
