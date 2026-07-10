import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, CheckCircle, Landmark, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { currencyLabelForCode, localRailForStoredUser } from '../../utils/presentation/africanRailDisplay';
import {
  africaCommercialRoutesForCountry,
  type AfricaRail,
  type AfricaCommercialRoute,
} from '../../utils/fees/africaCommercialPricing';

interface AfricaAddMoneyScreenProps {
  onBack: () => void;
}

function railLabel(rail: AfricaRail): string {
  return rail === 'mobile_money' ? 'Mobile Money' : 'Local bank account';
}

function railIcon(rail: AfricaRail) {
  return rail === 'mobile_money' ? Smartphone : Landmark;
}

function firstRoute(routes: AfricaCommercialRoute[]): AfricaCommercialRoute | null {
  return routes[0] || null;
}

export function AfricaAddMoneyScreen({ onBack }: AfricaAddMoneyScreenProps) {
  const tc = useThemeClasses();
  const localRail = useMemo(() => localRailForStoredUser(), []);
  const routes = useMemo(
    () => localRail ? africaCommercialRoutesForCountry('collection', localRail.countryCode, true) : [],
    [localRail],
  );
  const [selectedRail, setSelectedRail] = useState<AfricaRail>(() => firstRoute(routes)?.rail || 'mobile_money');
  const selectedRoute = routes.find((route) => route.rail === selectedRail) || firstRoute(routes);
  const [amount, setAmount] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerAccount, setPayerAccount] = useState('');

  const canReview = !!selectedRoute && Number(amount) > 0 && payerName.trim().length >= 2 && payerAccount.trim().length >= 6;

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <FloatingBackButton onBack={onBack} />
      <div className="max-w-2xl mx-auto px-5 pt-floating-back pb-28">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-2`}>
          Add money
        </p>
        <h1 className={`text-2xl font-semibold ${tc.text}`}>Africa collection</h1>
        <p className={`text-sm ${tc.textMuted} mt-2 leading-relaxed`}>
          Collect from local Mobile Money or bank rails, then settle into your BorderPay wallet.
        </p>

        {!localRail || routes.length === 0 ? (
          <div className={`mt-6 rounded-3xl border ${tc.cardBorder} ${tc.card} p-6`}>
            <p className={`text-sm font-semibold ${tc.text}`}>Local collection is not available for this profile.</p>
            <p className={`text-xs ${tc.textMuted} mt-2`}>
              Add Money appears only for supported African collection corridors.
            </p>
          </div>
        ) : (
          <>
            <div className={`mt-6 rounded-3xl border ${tc.cardBorder} ${tc.card} overflow-hidden`}>
              <div className="px-4 py-4 border-b border-white/[0.06] flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-2xl">
                  {localRail.flag}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${tc.text}`}>{localRail.country}</p>
                  <p className={`text-xs ${tc.textMuted}`}>{localRail.countryIso3} · {currencyLabelForCode(localRail.currency)} collection rails</p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Collection rail</label>
                  <div className="space-y-2">
                    {routes.map((route) => {
                      const Icon = railIcon(route.rail);
                      const active = selectedRoute?.rail === route.rail;
                      return (
                        <button
                          key={`${route.iso2}-${route.rail}`}
                          type="button"
                          onClick={() => setSelectedRail(route.rail)}
                          className={`w-full text-left border rounded-2xl p-4 flex items-center gap-3 transition-colors ${
                            active ? 'border-[#C7FF00]/60 bg-[#C7FF00]/10' : `${tc.cardBorder} ${tc.bgAlt}`
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center">
                            <Icon size={18} className={active ? 'text-[#C7FF00]' : tc.textMuted} />
                          </div>
                          <div className="flex-1">
                            <p className={`text-sm font-semibold ${tc.text}`}>{railLabel(route.rail)}</p>
                            <p className={`text-xs ${tc.textMuted}`}>BorderPay fee: {route.borderpayCustomerFee}</p>
                          </div>
                          {active && <CheckCircle size={16} className="text-[#C7FF00]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Amount to collect</label>
                  <div className="relative">
                    <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold ${tc.textMuted}`}>
                      {localRail.symbol}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0.00"
                      className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl pl-16 pr-4 py-4 text-xl font-semibold focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                    />
                  </div>
                </div>

                <div>
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>Payer name</label>
                  <input
                    type="text"
                    value={payerName}
                    onChange={(event) => setPayerName(event.target.value)}
                    placeholder="Full name"
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                </div>

                <div>
                  <label className={`text-xs font-medium ${tc.textSecondary} mb-2 block`}>
                    {selectedRoute?.rail === 'mobile_money' ? 'Mobile money number' : 'Bank account number'}
                  </label>
                  <input
                    type="text"
                    inputMode={selectedRoute?.rail === 'mobile_money' ? 'tel' : 'numeric'}
                    value={payerAccount}
                    onChange={(event) => setPayerAccount(event.target.value)}
                    placeholder={selectedRoute?.rail === 'mobile_money' ? '+254...' : 'Account number'}
                    className={`w-full ${tc.inputBg} border ${tc.borderLight} rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#C7FF00]/50 ${tc.text}`}
                  />
                </div>
              </div>
            </div>

            {selectedRoute && (
              <div className={`mt-4 rounded-3xl border ${tc.cardBorder} ${tc.card} p-4`}>
                <div className="flex items-center gap-2 mb-3">
                  <ArrowDownLeft className="w-4 h-4 text-[#C7FF00]" />
                  <p className={`text-sm font-semibold ${tc.text}`}>Collection preview</p>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className={tc.textMuted}>Payer sends</span>
                    <span className={tc.text}>{localRail.symbol} {amount || '0'} · {localRail.currency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={tc.textMuted}>BorderPay fee</span>
                    <span className={tc.text}>{selectedRoute.borderpayCustomerFee}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={tc.textMuted}>Settlement wallet</span>
                    <span className={tc.text}>USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={tc.textMuted}>FX quote</span>
                    <span className={tc.text}>Shown before live submit</span>
                  </div>
                </div>
              </div>
            )}

            <button
              disabled={!canReview}
              onClick={() => toast.error('Africa collections are locked until provider credentials are configured.')}
              className="w-full mt-5 bg-[#C7FF00] text-black py-4 rounded-full font-bold hover:bg-[#B8F000] transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Locked until provider credentials
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default AfricaAddMoneyScreen;
