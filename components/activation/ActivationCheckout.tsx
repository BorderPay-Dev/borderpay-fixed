/**
 * ActivationCheckout — opens the one-time activation payment INLINE (embedded),
 * so the user never leaves the app. Uses the Flutterwave inline widget
 * (checkout.flutterwave.com/v3.js) with the publishable key + the tx_ref our
 * server recorded; all enabled methods show (card, bank transfer, mobile money, …). The signature-verified webhook is what actually activates — the
 * callback here is just UX (confirm + refresh).
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { backendAPI } from '../../utils/api/backendAPI';
import { friendlyError } from '../../utils/errors/friendlyError';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

declare global {
  interface Window { FlutterwaveCheckout?: (opts: any) => { close?: () => void }; }
}

const V3 = 'https://checkout.flutterwave.com/v3.js';

function loadV3(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.FlutterwaveCheckout) return resolve(true);
    const existing = document.querySelector(`script[src="${V3}"]`);
    if (existing) { existing.addEventListener('load', () => resolve(!!window.FlutterwaveCheckout)); return; }
    const s = document.createElement('script');
    s.src = V3; s.async = true;
    s.onload = () => resolve(!!window.FlutterwaveCheckout);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export interface ActivationCheckoutProps {
  open: boolean;
  onClose: () => void;
}

export function ActivationCheckout({ open, onClose }: ActivationCheckoutProps) {
  const tc = useThemeClasses();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'starting' | 'paying' | 'confirming'>('starting');

  const start = async () => {
    setError(null);
    setPhase('starting');
    try {
      const r: any = await backendAPI.subscription.startActivationCheckout();
      if (!r?.success || !r.data?.public_key) {
        setError(friendlyError(r?.error, 'Could not start activation. Please try again.'));
        return;
      }
      const ok = await loadV3();
      if (!ok || !window.FlutterwaveCheckout) {
        setError('Could not load secure checkout. Check your connection and try again.');
        return;
      }
      const d = r.data;
      setPhase('paying');
      window.FlutterwaveCheckout({
        public_key:   d.public_key,
        tx_ref:       d.tx_ref,
        amount:       d.amount,
        currency:     d.currency,
        // Omit payment_options → every method enabled on the account shows
        // (card, bank transfer, USSD, mobile money…).
        redirect_url: d.redirect_url,
        customer:     { email: d.email, name: d.name || undefined },
        customizations: {
          title: 'BorderPay Activation',
          description: 'Activate your BorderPay Global Wallet',
        },
        callback: () => {
          // Payment captured. The webhook activates server-side; show a
          // confirming state (the widget closes itself, then onclose fires).
          setPhase('confirming');
        },
        onclose: () => {
          // Modal dismissed (paid or cancelled). Close our sheet + nudge a
          // refresh so an activated plan reflects.
          onClose();
          try { window.location.assign(`${window.location.pathname}?activation=return`); } catch { /* noop */ }
        },
      });
    } catch (e) {
      setError(friendlyError(e, 'Could not start activation. Please try again.'));
    }
  };

  useEffect(() => {
    if (open) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While the Flutterwave modal is open we keep our own sheet minimal/behind it.
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[9990] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            className="fixed inset-x-0 bottom-0 z-[9991] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-sm"
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
                    <h2 className={`text-lg font-semibold ${tc.text} mb-2`}>
                      {phase === 'confirming' ? 'Confirming your activation…' : 'Opening secure checkout…'}
                    </h2>
                    <p className={`text-sm ${tc.textMuted} max-w-xs mx-auto mb-5`}>
                      Pay by card, bank transfer, mobile money and more — without leaving the app.
                    </p>
                    <Loader2 className={`w-6 h-6 ${tc.textSecondary} animate-spin mx-auto`} />
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
