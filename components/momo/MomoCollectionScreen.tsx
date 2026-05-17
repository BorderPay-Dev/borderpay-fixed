/**
 * BorderPay Africa — Mobile Money Collection (Coming Soon)
 *
 * Mobile money is a future-state African rail that will be brought online via
 * the planned Yativo integration. There is no live implementation today.
 *
 * This screen previously walked the user through currency / provider / phone
 * / amount / review / OTP and submitted to a legacy-provider collection
 * endpoint. It has been replaced with a single Coming Soon state so users
 * are not led through a flow that only fails at the final step.
 *
 * Backend equivalents (mobileMoneyAPI.getProviders / collect / verifyMomoOTP)
 * return `rails_future_state` without any network call.
 *
 * Props are preserved so MainApp.tsx and any nav route keep type-checking.
 */

import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Smartphone, Bell } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface Props {
  onBack:      () => void;
  onComplete?: () => void;
}

export function MomoCollectionScreen({ onBack }: Props) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const tt = (k: string, fb: string) => ((t as any)?.(k) ?? fb) as string;

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className={`sticky top-0 z-10 ${tc.headerBg} border-b ${tc.border}`}>
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={tt('common.back', 'Back')}
            className={`p-2 -ml-2 rounded-full ${tc.hoverBg} transition`}
          >
            <ArrowLeft className={`w-5 h-5 ${tc.text}`} />
          </button>
          <h1 className={`text-lg font-semibold ${tc.text}`}>
            {tt('momo.title', 'Mobile Money')}
          </h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-8 sm:p-12 text-center`}
        >
          <div className="mx-auto w-20 h-20 rounded-2xl bg-[#C7FF00] flex items-center justify-center mb-6">
            <Smartphone className="w-10 h-10 text-black" strokeWidth={2} />
          </div>

          <h2 className={`text-2xl sm:text-3xl font-bold ${tc.text} mb-3`}>
            {tt('momo.future.title', 'Coming Soon')}
          </h2>
          <p className={`text-base ${tc.textSecondary} max-w-md mx-auto leading-relaxed`}>
            {tt(
              'momo.future.body',
              'Mobile money cash-in and cash-out across African corridors is launching soon via our local payments partner.'
            )}
          </p>

          <button
            type="button"
            disabled
            aria-disabled="true"
            className={`mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-full border ${tc.border} ${tc.textMuted} cursor-not-allowed opacity-60`}
          >
            <Bell className="w-4 h-4" />
            <span className="text-sm font-medium">
              {tt('momo.future.notify', 'Notify me when it launches')}
            </span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}

export default MomoCollectionScreen;
