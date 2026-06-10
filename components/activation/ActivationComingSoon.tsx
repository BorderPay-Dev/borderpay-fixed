/**
 * ActivationComingSoon — interim gate-1 (activation payment) state.
 *
 * The activation funnel is: pay one-time fee → email (payment confirmation +
 * KYC link) → verify ID → accounts provision via Bridge webhooks. Gate-1
 * payment is collected by an external gateway (Flutterwave / Stripe) that is
 * pending account approval, so until ACTIVATION_GATEWAY_LIVE flips true every
 * activation CTA opens this clean "opening soon" sheet instead of a checkout
 * the user can't complete yet.
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Globe2, Wallet, ArrowLeftRight } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export interface ActivationComingSoonProps {
  open: boolean;
  isBusiness?: boolean;
  onClose: () => void;
}

export function ActivationComingSoon({ open, isBusiness = false, onClose }: ActivationComingSoonProps) {
  const tc = useThemeClasses();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed inset-x-0 bottom-0 z-[9999] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-sm"
          >
            <div className={`mx-auto w-full max-w-md ${tc.card} border ${tc.cardBorder} rounded-t-3xl sm:rounded-3xl overflow-hidden`}
                 style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              <div className="flex justify-end p-3">
                <button onClick={onClose} aria-label="Close" className={`p-2 rounded-full ${tc.hoverBg}`}>
                  <X className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
              </div>

              <div className="px-6 pb-7 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-[#C7FF00]" />
                </div>
                <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>
                  Activate your {isBusiness ? 'BorderPay Business Wallet' : 'BorderPay Global Wallet'}
                </h2>
                <p className={`text-sm ${tc.textMuted} leading-relaxed max-w-xs mx-auto`}>
                  Activate your BorderPay Global Wallet to enable international transfers,
                  Global and African payouts, and multi-currency balances.
                </p>

                {/* What activation unlocks */}
                <div className={`mt-6 rounded-2xl border ${tc.borderLight} ${tc.bgAlt} text-left divide-y ${tc.borderLight}`}>
                  <Step icon={<ArrowLeftRight className="w-4 h-4 text-[#C7FF00]" />} title="International transfers" body="Send worldwide and across Africa." tc={tc} />
                  <Step icon={<Globe2 className="w-4 h-4 text-[#C7FF00]" />} title="Global & African payouts" body="Pay people and businesses in their currency." tc={tc} />
                  <Step icon={<Wallet className="w-4 h-4 text-[#C7FF00]" />} title="Multi-currency balances" body="Hold USD, EUR, GBP and stablecoins." tc={tc} />
                </div>

                <p className={`mt-4 text-[11px] ${tc.textMuted}`}>
                  A one-time activation — your wallet unlocks permanently.
                </p>

                <button
                  onClick={onClose}
                  className="mt-5 w-full py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition"
                >
                  {/* Payment collection turns on with the gateway; until then this
                      is informational so users aren't sent to a checkout that
                      can't complete yet. */}
                  Got it
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Step({ icon, title, body, tc }: { icon: React.ReactNode; title: string; body: string; tc: any }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-lg bg-[#C7FF00]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${tc.text}`}>{title}</p>
        <p className={`text-[11px] ${tc.textMuted} leading-snug`}>{body}</p>
      </div>
    </div>
  );
}

export default ActivationComingSoon;
