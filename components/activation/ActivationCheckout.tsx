/**
 * ActivationCheckout — starts the one-time activation payment and sends the
 * user to the secure hosted checkout, which shows every payment method enabled
 * on the account (card, bank transfer, USSD, mobile money, …).
 *
 * (We tried the inline widget, but with a USD charge it only surfaced a couple of methods — the hosted page exposes the full set. On return Flutterwave
 * redirects to /?activation=return and the webhook activates server-side.)
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

export interface ActivationCheckoutProps {
  open: boolean;
  onClose: () => void;
}

export function ActivationCheckout({ open, onClose }: ActivationCheckoutProps) {
  const tc = useThemeClasses();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const r: any = await backendAPI.subscription.startActivationCheckout();
      const url = r?.success && r.data?.checkout_url;
      if (url) {
        window.location.href = url;          // hosted checkout (all methods)
        return;
      }
      setError(friendlyError(r?.error, 'Could not start activation. Please try again.'));
      setStarting(false);
    } catch (e) {
      setError(friendlyError(e, 'Could not start activation. Please try again.'));
      setStarting(false);
    }
  };

  useEffect(() => {
    if (open) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            className="fixed inset-x-0 bottom-0 z-[9999] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-sm"
          >
            <div className={`mx-auto w-full max-w-md ${tc.card} border ${tc.cardBorder} rounded-t-3xl sm:rounded-3xl overflow-hidden`}
                 style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              <div className="flex justify-end p-3">
                <button onClick={onClose} aria-label="Close" className={`p-2 rounded-full ${tc.hoverBg}`}>
                  <X className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
              </div>
              <div className="px-6 pb-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center mx-auto mb-4">
                  {error ? <AlertCircle className="w-8 h-8 text-red-400" /> : <Sparkles className="w-8 h-8 text-[#C7FF00]" />}
                </div>
                {error ? (
                  <>
                    <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Couldn’t start activation</h2>
                    <p className={`text-sm ${tc.textMuted} max-w-xs mx-auto`}>{error}</p>
                    <button onClick={start} className="mt-6 w-full py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition">
                      Try again
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>Taking you to secure checkout…</h2>
                    <p className={`text-sm ${tc.textMuted} max-w-xs mx-auto mb-5`}>
                      Activate your BorderPay Global Wallet. Pay by card, bank transfer,
                      mobile money and more.
                    </p>
                    {starting && <Loader2 className={`w-6 h-6 ${tc.textSecondary} animate-spin mx-auto`} />}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default ActivationCheckout;
