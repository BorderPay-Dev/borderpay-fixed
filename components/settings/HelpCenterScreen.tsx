/**
 * BorderPay Africa - Help Center Screen
 */

import React from 'react';
import { ArrowLeft, Mail, FileText, Shield, ChevronRight, ExternalLink } from 'lucide-react';
import { useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';

interface HelpCenterScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const faqItems = [
  {
    question: 'How do I add money to my wallet?',
    answer: 'Tap "Add Money" on the dashboard. You can fund your wallet via bank transfer, mobile money, or card deposit.',
  },
  {
    question: 'How long do transfers take?',
    answer: 'Domestic transfers are instant. International transfers typically take 1-3 business days depending on the destination.',
  },
  {
    question: 'What are the transfer fees?',
    answer: 'BorderPay charges low, transparent fees. You can see the exact fee before confirming any transaction.',
  },
  {
    question: 'How do I get a virtual card?',
    answer: 'Go to Cards → Create Your First Card. Choose a design, fund it, and your card is ready instantly.',
  },
  {
    question: 'Is my money safe?',
    answer: 'Yes. BorderPay uses bank-grade encryption, 2FA, and your funds are held in regulated financial institutions.',
  },
  {
    question: 'How do I verify my identity (KYC)?',
    answer: 'Go to Settings → KYC Documents. You\'ll need a valid government ID and a selfie for verification.',
  },
];

export function HelpCenterScreen({ onBack, onNavigate }: HelpCenterScreenProps) {
  const tc = useThemeClasses();
  const [expandedFaq, setExpandedFaq] = React.useState<number | null>(null);

  return (
    <div className={`min-h-screen ${tc.bg} pb-safe`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 ${tc.headerBg} backdrop-blur-lg border-b ${tc.borderLight}`}>
        <div className="flex items-center justify-between px-6 py-4 pt-safe">
          <button
            onClick={onBack}
            className={`w-10 h-10 rounded-full ${tc.card} flex items-center justify-center`}
          >
            <ArrowLeft size={20} className={tc.text} />
          </button>
          <h1 className={`text-lg font-bold ${tc.text}`}>Help Center</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Contact Support Card */}
        <div className={`${tc.card} border ${tc.cardBorder} rounded-2xl p-5`}>
          <h2 className={`text-base font-bold ${tc.text} mb-1`}>Need Help?</h2>
          <p className={`text-sm ${tc.textSecondary} mb-4`}>
            Our support team is here to assist you.
          </p>

          <a
            href="mailto:support@borderpayafrica.com"
            className="flex items-center gap-3 p-3 rounded-xl bg-[#C7FF00]/10 border border-[#C7FF00]/20"
          >
            <div className="w-10 h-10 rounded-full bg-[#C7FF00]/20 flex items-center justify-center">
              <Mail size={18} className="text-[#C7FF00]" />
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${tc.text}`}>Email Support</p>
              <p className="text-xs text-[#C7FF00]">support@borderpayafrica.com</p>
            </div>
            <ExternalLink size={16} className={tc.textSecondary} />
          </a>
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
