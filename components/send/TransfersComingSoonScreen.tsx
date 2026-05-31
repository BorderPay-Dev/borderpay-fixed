/**
 * TransfersComingSoonScreen — honest disabled state for the Send flow.
 *
 * Rendered by MainApp on `case 'send-money'` when the frontend
 * `TRANSFERS_LIVE` flag is false. Replaces SendMoneyFlow for that route
 * so the user lands on a clear, no-timeline page instead of starting a
 * flow that would fail at submit (the backend `bridge-transfer` edge
 * function is gated by `BRIDGE_TRANSFERS_ENABLED` and returns a generic
 * error when off).
 *
 * Copy rules (per CTO directive, partner onboarding readiness):
 *   • No timeline ("soon", "this week", "in X days") — none.
 *   • No partner name, no industry, no geography hint.
 *   • Make clear collections / virtual accounts are being prepared
 *     separately from outbound transfers, so users with KYB approved
 *     understand why accounts may light up before transfers do.
 *   • Generic Back button only — no Notify-me or email-capture
 *     (no lead-collection without explicit authorization).
 *
 * No analytics, no fetches, no localStorage writes. Pure presentational.
 */

import React from 'react';
import { ArrowUpRight, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface TransfersComingSoonScreenProps {
  onBack: () => void;
}

export function TransfersComingSoonScreen({ onBack }: TransfersComingSoonScreenProps) {
  const tc = useThemeClasses();

  return (
    <div className={`min-h-screen ${tc.bg} flex flex-col`}>
      {/* ── Top bar with Back ───────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-5 sm:px-6 pt-safe-header pb-3">
        <button
          onClick={onBack}
          className={`w-9 h-9 rounded-full ${tc.card} border ${tc.cardBorder} flex items-center justify-center ${tc.hoverBg}`}
          aria-label="Back"
        >
          <ArrowLeft className={`w-4 h-4 ${tc.text}`} />
        </button>
        <h1 className={`text-base font-semibold ${tc.text}`}>Send money</h1>
      </header>

      {/* ── Card ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center px-5 sm:px-6 pt-8">
        <div className={`w-full max-w-md rounded-3xl border ${tc.cardBorder} ${tc.card} p-6 sm:p-8`}>
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#C7FF00] flex items-center justify-center mb-5">
              <ArrowUpRight className="w-7 h-7 text-black" strokeWidth={2} />
            </div>

            <h2 className={`text-xl font-bold ${tc.text} mb-2`}>
              Transfers activating soon
            </h2>

            <p className={`text-sm ${tc.textSecondary} leading-relaxed mb-5`}>
              Outbound transfers aren&apos;t available yet. Once activated, you&apos;ll be able to send funds from this screen.
            </p>

            <div className={`w-full rounded-2xl border ${tc.cardBorder} ${tc.bgAlt ?? 'bg-white/[0.03]'} p-4 text-left mb-5`}>
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <ShieldCheck className={`w-5 h-5 ${tc.text}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${tc.text} mb-1`}>
                    Collections and accounts are separate
                  </p>
                  <p className={`text-xs ${tc.textMuted} leading-relaxed`}>
                    Virtual accounts and wallets can be set up and used to receive funds independently. They&apos;re being prepared on a separate track from outbound transfers.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={onBack}
              className={`w-full py-3 rounded-2xl ${tc.card} border ${tc.cardBorder} ${tc.text} font-semibold text-sm ${tc.hoverBg}`}
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default TransfersComingSoonScreen;
