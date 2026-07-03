import React, { useEffect } from 'react';
import { Clock } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
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
    <div className={`min-h-screen ${tc.bg} relative`}>
      <FloatingBackButton onBack={onBack} />
      <div className="px-5 pt-28 pb-8">
        <div className={`${tc.card} ${tc.cardBorder} border rounded-2xl p-5`}>
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-[#C7FF00]" />
            <h2 className={`text-base font-semibold ${tc.text}`}>Payroll is coming soon</h2>
          </div>
          <p className={`text-sm ${tc.textMuted}`}>
            Payroll route is staged and will be enabled after final runtime checks.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PayrollComingSoonScreen;
