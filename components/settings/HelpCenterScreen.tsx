/**
 * BorderPay Africa - Help Center Screen
 */

import React from 'react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { MessageSquare, FileText, Shield, ChevronRight } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface HelpCenterScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const faqItems = [
  {
    question: 'How do I add money to my wallet?',
    answer: 'Tap "Receive" or "Add Money" on the dashboard to see the account and wallet options currently available for your country.',
  },
  {
    question: 'How long do transfers take?',
    answer: 'Transfer timing depends on the payout rail and destination country. BorderPay shows the current transfer status in your transaction history.',
  },
  {
    question: 'What are the transfer fees?',
    answer: 'BorderPay charges low, transparent fees. You can see the exact fee before confirming any transaction.',
  },
  {
    question: 'How do I get a virtual card?',
    answer: 'Cards are locked for now. BorderPay will enable card creation only after the card backend is approved and live.',
  },
  {
    question: 'Is my money safe?',
    answer: 'Yes. BorderPay uses bank-grade encryption, 2FA, and your funds are held in regulated financial institutions.',
  },
  {
    question: 'How do I verify my identity (KYC)?',
    answer: 'Open the Verify Identity action in your account, then continue in the hosted verification flow. You\'ll need a valid government ID and may be asked for a selfie.',
  },
];

export function HelpCenterScreen({ onBack, onNavigate }: HelpCenterScreenProps) {
  const tc = useThemeClasses();
  const [expandedFaq, setExpandedFaq] = React.useState<number | null>(null);

  React.useEffect(() => {
    try {
      const prewarmKey = 'borderpay_help_center_prewarm_v1';
      const last = Number(sessionStorage.getItem(prewarmKey) || '0');
      if (Number.isFinite(last) && Date.now() - last < 180_000) return;
      const prefetch = (window as any).__borderpay_prefetch;
      if (typeof prefetch !== 'function') return;
      const warm = () => {
        ['support', 'terms-of-service', 'privacy-policy', 'settings'].forEach((screen) => {
          try { prefetch(screen); } catch { /* noop */ }
        });
      };
      const ric = (window as any).requestIdleCallback;
      if (typeof ric === 'function') ric(warm, { timeout: 900 });
      else setTimeout(warm, 120);
      sessionStorage.setItem(prewarmKey, String(Date.now()));
    } catch { /* noop */ }
  }, []);

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <FloatingBackButton onBack={onBack} />
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <div className="w-10" />
          <h1 className={`text-lg font-bold ${tc.text}`}>Help Center</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* In-app Support Card */}
        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
          <h2 className={`text-base font-bold ${tc.text} mb-1`}>Need Help?</h2>
          <p className={`text-sm ${tc.textSecondary} mb-4`}>
            Contact BorderPay support directly in-app.
          </p>

          <button
            onClick={() => onNavigate?.('support')}
            className="flex items-center gap-3 p-3 rounded-xl bg-[#C7FF00]/10 border border-[#C7FF00]/20"
          >
            <div className="w-10 h-10 rounded-full bg-[#C7FF00]/20 flex items-center justify-center">
              <MessageSquare size={18} className="text-[#C7FF00]" />
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${tc.text}`}>Open Support</p>
              <p className="text-xs text-[#C7FF00]">Create and track tickets in-app</p>
            </div>
            <ChevronRight size={16} className={tc.textSecondary} />
          </button>
        </div>

        {/* Response Time */}
        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-4 flex items-center gap-3`}>
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className={`text-sm ${tc.textSecondary}`}>
            Average response time: <span className={`font-semibold ${tc.text}`}>under 2 hours</span>
          </p>
        </div>

        {/* FAQ Section */}
        <div>
          <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider mb-3`}>
            Frequently Asked Questions
          </h2>
          <div className="space-y-2">
            {faqItems.map((faq, index) => (
              <button
                key={index}
                onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                className={`w-full text-left ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 transition-all`}
              >
                <div className="flex items-center justify-between">
                  <p className={`text-sm font-semibold ${tc.text} pr-4`}>{faq.question}</p>
                  <ChevronRight
                    size={16}
                    className={`${tc.textSecondary} transition-transform flex-shrink-0 ${expandedFaq === index ? 'rotate-90' : ''}`}
                  />
                </div>
                {expandedFaq === index && (
                  <p className={`text-sm ${tc.textSecondary} mt-3 leading-relaxed`}>
                    {faq.answer}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h2 className={`text-xs font-semibold ${tc.textSecondary} uppercase tracking-wider mb-3`}>
            Quick Links
          </h2>
          <div className="space-y-2">
            {[
              { icon: FileText, label: 'Terms of Service', screen: 'terms-of-service' },
              { icon: Shield, label: 'Privacy Policy', screen: 'privacy-policy' },
            ].map((link) => (
              <button
                key={link.label}
                onClick={() => onNavigate?.(link.screen)}
                className={`w-full ${tc.card} border ${tc.cardBorder} rounded-2xl p-4 flex items-center gap-3 active:opacity-80 transition-opacity`}
              >
                <link.icon size={18} className={tc.textSecondary} />
                <p className={`text-sm font-medium ${tc.text} flex-1 text-left`}>{link.label}</p>
                <ChevronRight size={16} className={tc.textSecondary} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
