import React, { useEffect } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Wallet, Banknote, ArrowRightLeft } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { navPerfTrackCache } from '../../utils/performance/navigationPerf';

export function RampsScreen({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (screen: string) => void;
}) {
  const tc = useThemeClasses();

  useEffect(() => {
    // Navigation hub screen; should not block render on network.
    navPerfTrackCache('ramps', true);
  }, []);

  return (
    <div className={`min-h-screen ${tc.bg} pt-floating-back`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-5 pb-24">
        <h1 className={`text-xl font-bold ${tc.text} mb-1`}>On/Off-ramps</h1>
        <p className={`text-sm ${tc.textMuted} mb-6`}>
          Manage funding in and payouts out from one place.
        </p>

        <div className={`rounded-2xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
          <RampRow
            tc={tc}
            icon={<ArrowDownToLine className="w-4 h-4 text-[#C7FF00]" />}
            title="On-ramp: Fund Wallet"
            subtitle="Deposit stablecoins and top up business balances."
            onClick={() => onNavigate('add-money')}
          />
          <RampRow
            tc={tc}
            icon={<Wallet className="w-4 h-4 text-[#C7FF00]" />}
            title="On-ramp: Receive Accounts"
            subtitle="Share stablecoin addresses and virtual account details."
            onClick={() => onNavigate('receive-money')}
            withBorder
          />
          <RampRow
            tc={tc}
            icon={<ArrowUpFromLine className="w-4 h-4 text-[#C7FF00]" />}
            title="Off-ramp: Send Funds"
            subtitle="Single payouts to bank or external stablecoin accounts."
            onClick={() => onNavigate('send-money')}
            withBorder
          />
          <RampRow
            tc={tc}
            icon={<Banknote className="w-4 h-4 text-[#C7FF00]" />}
            title="Off-ramp: External Accounts"
            subtitle="Manage saved bank payout destinations."
            onClick={() => onNavigate('external-accounts')}
            withBorder
          />
          <RampRow
            tc={tc}
            icon={<ArrowRightLeft className="w-4 h-4 text-[#C7FF00]" />}
            title="FX Conversion"
            subtitle="Convert between supported currencies at live rates."
            onClick={() => onNavigate('exchange')}
            withBorder
          />
        </div>
      </div>
    </div>
  );
}

function RampRow({
  tc,
  icon,
  title,
  subtitle,
  onClick,
  withBorder,
}: {
  tc: ReturnType<typeof useThemeClasses>;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  withBorder?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3.5 flex items-center gap-3 text-left ${tc.hoverBg} transition-colors ${withBorder ? `border-t ${tc.borderLight}` : ''}`}
    >
      <div className={`w-9 h-9 rounded-full ${tc.bgAlt} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${tc.text}`}>{title}</p>
        <p className={`text-[11px] ${tc.textMuted}`}>{subtitle}</p>
      </div>
    </button>
  );
}

export default RampsScreen;
