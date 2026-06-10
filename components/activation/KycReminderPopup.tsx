/**
 * KycReminderPopup — dashboard nudge for users who haven't verified yet.
 *
 * Shows once per session (so it reminds on each login, not on every navigation),
 * disappears entirely once the user is verified, and its CTA opens the Identity
 * & KYC screen where the user taps "Verify" (free, in-app).
 *
 * Render with: open = (not verified && not rejected). Caller controls that.
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, ArrowRight } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

const DISMISS_KEY = 'borderpay_kyc_reminder_dismissed';

export function KycReminderPopup({
  open, isBusiness = false, onVerify, onClose,
}: {
  open: boolean;
  isBusiness?: boolean;
  onVerify: () => void;
  onClose: () => void;
}) {
  const tc = useThemeClasses();

  // Once-per-session: if already dismissed this session, don't show again until
  // the next login (sessionStorage clears when the tab/session ends).
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });
  const close = () => {
    try { sessionStorage.setItem(DISMISS_KEY, 'true'); } catch { /* noop */ }
    setDismissed(true);
    onClose();
  };
  const verify = () => {
    try { sessionStorage.setItem(DISMISS_KEY, 'true'); } catch { /* noop */ }
    setDismissed(true);
    onVerify();
  };

  const show = open && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={close}
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
                <button onClick={close} aria-label="Close" className={`p-2 rounded-full ${tc.hoverBg}`}>
                  <X className={`w-4 h-4 ${tc.textMuted}`} />
                </button>
              </div>
              <div className="px-6 pb-7 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#C7FF00]/15 flex items-center justify-center mx-auto mb-4">
                  <ShieldCheck className="w-8 h-8 text-[#C7FF00]" />
                </div>
                <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>
                  {isBusiness ? 'Verify your business' : 'Verify your identity'}
                </h2>
                <p className={`text-sm ${tc.textMuted} leading-relaxed max-w-xs mx-auto`}>
                  It’s free and takes a few minutes. Verify to unlock USD, EUR &amp; GBP
                  accounts, cards, and your wallet.
                </p>
                <button
                  onClick={verify}
                  className="mt-6 w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#C7FF00] text-black font-semibold text-sm hover:brightness-95 transition"
                >
                  {isBusiness ? 'Verify business' : 'Verify now'} <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={close} className={`mt-3 text-[12px] font-semibold ${tc.textMuted} hover:${tc.text}`}>
                  Maybe later
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default KycReminderPopup;
