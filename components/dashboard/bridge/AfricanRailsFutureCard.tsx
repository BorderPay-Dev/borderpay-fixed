/**
 * AfricanRailsFutureCard — disabled product card surfacing future African
 * on/off-ramp coverage. Lists target corridors but no live action is
 * available. African local-currency / mobile-money rails are future-state
 * until BorderPay enables them. No backend call is made from this card.
 */

import React from 'react';
import { Globe2, Bell } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../../utils/i18n/ThemeLanguageContext';

const FUTURE_CORRIDORS: { code: string; label: string; country: string }[] = [
  { code: 'NGN', label: 'Nigerian naira',   country: 'Nigeria' },
  { code: 'KES', label: 'Kenyan shilling',  country: 'Kenya' },
  { code: 'GHS', label: 'Ghanaian cedi',    country: 'Ghana' },
  { code: 'UGX', label: 'Ugandan shilling', country: 'Uganda' },
  { code: 'ZAR', label: 'South African rand', country: 'South Africa' },
  { code: 'XOF', label: 'West African CFA franc', country: 'WAEMU' },
];

export function AfricanRailsFutureCard() {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  return (
    <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6`}>
      <div className="flex items-start gap-4 mb-4">
        <div className="shrink-0 w-12 h-12 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center">
          <Globe2 className="w-6 h-6 text-black dark:text-white" />
        </div>
        <div className="flex-1">
          <h3 className={`text-base font-semibold ${tc.text} mb-1 flex items-center gap-2`}>
            {tt('dash.african.title', 'African on/off ramps')}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${tc.bgAlt} ${tc.textMuted} border ${tc.border}`}>
              {tt('dash.african.badge', 'Future coverage')}
            </span>
          </h3>
          <p className={`text-sm ${tc.textSecondary}`}>
            {tt('dash.african.subtitle', 'BorderPay local-currency cash-in and cash-out is coming soon.')}
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-2 mb-4">
        {FUTURE_CORRIDORS.map(c => (
          <li
            key={c.code}
            className={`p-2.5 rounded-2xl ${tc.bgAlt} border ${tc.border} flex items-center justify-between`}
          >
            <div>
              <div className={`text-xs font-semibold ${tc.text}`}>{c.code}</div>
              <div className={`text-[10px] ${tc.textMuted}`}>{c.country}</div>
            </div>
            <span className={`text-[10px] ${tc.textMuted}`}>{tt('dash.african.soon', 'soon')}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled
        aria-disabled="true"
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${tc.border} ${tc.textMuted} text-xs cursor-not-allowed opacity-60`}
      >
        <Bell className="w-3.5 h-3.5" />
        <span>{tt('dash.african.notify', 'Notify me when corridors open')}</span>
      </button>
    </div>
  );
}

export default AfricanRailsFutureCard;
