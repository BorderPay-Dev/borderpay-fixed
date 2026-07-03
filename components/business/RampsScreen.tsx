import React, { useEffect } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

interface RampsScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

export function RampsScreen({ onBack, onNavigate }: RampsScreenProps) {
  const tc = useThemeClasses();

  useEffect(() => {
    navPerfTrackCache('ramps', true);
  }, []);

  return (
    <div className={`min-h-screen ${tc.bg} relative`}>
      <FloatingBackButton onBack={onBack} />
      <div className="px-5 pt-28 pb-8 space-y-3">
        <div className={`${tc.card} ${tc.cardBorder} border rounded-2xl p-5`}>
          <div className="flex items-center gap-3 mb-2">
            <ArrowDownToLine className="w-5 h-5 text-[#C7FF00]" />
            <h2 className={`text-base font-semibold ${tc.text}`}>Receive routes</h2>
          </div>
          <p className={`text-sm ${tc.textMuted}`}>
            Ramps route is mapped to the unified receive flow.
          </p>
          <button
            onClick={() => onNavigate?.('receive-money')}
            className="mt-4 px-4 py-2 rounded-xl bg-[#C7FF00] text-black text-sm font-semibold"
          >
            Open Receive
          </button>
        </div>
      </div>
    </div>
  );
}

export default RampsScreen;
