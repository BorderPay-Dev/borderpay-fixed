/**
 * BorderPay Africa - Terms of Service Screen
 * Full scrollable terms with sections, beautiful typography
 * Mobile-optimized with neon green accents
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Globe, Lock, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';

interface TermsOfServiceScreenProps {
  onBack: () => void;
  onAccept?: () => void;
  showAcceptButton?: boolean;
}

export function TermsOfServiceScreen({ onBack, onAccept, showAcceptButton = false }: TermsOfServiceScreenProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview']));
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrolledToBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    if (scrolledToBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true);
    }
  };

  const sections = [
    {
      id: 'overview',
      title: 'Welcome to BorderPay Africa',
      icon: Globe,
      content: (
        <>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            These Terms of Service ("Terms") govern your access to and use of the BorderPay Africa mobile application, website (borderpayafrica.com or any affiliated sites), and related services (collectively, the "Services") provided by BorderPay Africa.
          </p>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            By accessing or using the Services, you agree to be bound by these Terms, our Privacy Policy, and our AML/KYC Policy. If you are using the Services on behalf of a business or entity, you represent that you have the authority to bind that entity to these Terms.
          </p>
          <div className="bg-[#C7FF00]/10 border border-[#C7FF00]/30 rounded-2xl p-4">
            <p className="text-[#C7FF00] text-xs font-semibold uppercase tracking-wide mb-2">Effective Date</p>
            <p className="text-white text-sm">November 14, 2024</p>
          </div>
        </>
      ),
    },
    {
      id: 'eligibility',
      title: '1. Eligibility and Geographic Scope',
      icon: Globe,
      content: (
        <>
          <h3 className="text-white font-bold text-sm mb-3">1.1 Global Service</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            BorderPay Africa is a global digital banking platform serving individuals and businesses worldwide, except in restricted jurisdictions. Eligibility is determined by our licensed partners' coverage and applicable compliance policies.
          </p>
          
          <h3 className="text-white font-bold text-sm mb-3">1.2 Eligible Countries</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            We onboard eligible individuals and businesses worldwide, except in restricted jurisdictions. Availability of specific accounts, cards, and payout rails depends on your country and our licensed partners' coverage, shown in the app.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">1.3 Restricted Countries</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            Due to international sanctions, compliance requirements, or regulatory restrictions, we may not be able to onboard users from certain jurisdictions or those appearing on OFAC, UN, EU, or AU sanctions lists.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">1.4 Age and Capacity</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            You must be at least 18 years old (or the age of majority in your jurisdiction) to use the Services.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">1.5 Account Registration</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            To access certain features, you must create an account by providing accurate information. You agree to:
          </p>
          <ul className="space-y-2 mb-4">
            {[
              'Keep your account credentials confidential and secure',
              'Notify us immediately of any unauthorized access or use',
              'Be fully responsible for all activity under your account',
              'Provide valid government-issued identification documents',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: 'kyc',
      title: '2. Identity Verification (KYC)',
      icon: Shield,
      content: (
        <>
          <h3 className="text-white font-bold text-sm mb-3">2.1 Accepted Identity Documents</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            BorderPay Africa accepts valid government-issued identity documents. Accepted documents include:
          </p>
          <ul className="space-y-2 mb-4">
            {[
              'Passport: Valid government-issued passport',
              'National ID Card: Government-issued national identity card',
              'Driver\'s License: Valid government-issued driver\'s license',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-[#C7FF00] rounded-full flex-shrink-0 mt-2" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-3 mb-4">
            <p className="text-white/70 text-xs font-semibold">
              Documents must be valid, unexpired, and clearly legible.
            </p>
          </div>

          <h3 className="text-white font-bold text-sm mb-3">2.2 Verification Process</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            Identity verification is completed through BorderPay's secure verification flow. The verification process:
          </p>
          <ul className="space-y-2">
            {[
              'Typically completes within 5-15 minutes',
              'Requires a clear photo of your ID document',
              'May require a selfie for biometric verification',
              'Fully compliant with applicable AML regulations',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: 'services',
      title: '3. Description of Services',
      icon: Globe,
      content: (
        <>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            BorderPay Africa provides a mobile application and digital banking platform for global cross-border payments, remittances, multi-currency wallet and account access, and related fintech services. Card access remains locked until enabled by BorderPay.
          </p>
          
          <h3 className="text-white font-bold text-sm mb-3">Core Services:</h3>
          <div className="grid grid-cols-1 gap-2 mb-4">
            {[
              'Digital Wallet: Available wallet options depend on your country',
              'Virtual Accounts: Supported account currencies are shown in the app',
              'Cards: Card access is locked until enabled by BorderPay',
              'Transfers: Live routes and limits are shown before you submit',
              'Local Rails: Local-currency and mobile-wallet routes are future-state until enabled',
              'Verification: Identity and business checks are required for regulated services',
              'Currency Exchange: Available only where enabled in the app',
            ].map((service, index) => (
              <div key={index} className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl p-3">
                <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
                <span className="text-white/90 text-sm">{service}</span>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      id: 'fees',
      title: '4. Services and Fees',
      icon: Lock,
      content: (
        <>
          <h3 className="text-white font-bold text-sm mb-3">What's Included</h3>
          <ul className="space-y-2 mb-4">
            {[
              'Country-dependent wallet and account options',
              'Cards remain locked until BorderPay enables card access',
              'Card network wallets are not live yet',
              'Digital dollar support (USDT, USDC)',
              'Local mobile-wallet routes are future-state until enabled',
              'Customer support',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-white/90 text-sm leading-relaxed">
              <strong className="text-white">Fee Structure:</strong> All fees are charged in USD and displayed transparently before transaction confirmation. Fees are non-refundable except as required by applicable consumer protection laws.
            </p>
          </div>
        </>
      ),
    },
    {
      id: 'responsibilities',
      title: '5. User Responsibilities',
      icon: Shield,
      content: (
        <>
          <h3 className="text-white font-bold text-sm mb-3">5.1 Your Obligations</h3>
          <ul className="space-y-2 mb-4">
            {[
              'Use Services only for lawful purposes',
              'Provide accurate, current, and complete information',
              'Maintain the security of your account credentials',
              'Comply with all KYC/AML requirements',
              'Report any suspicious activity immediately',
              'Use valid government-issued identity documents',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-white font-bold text-sm mb-3">5.2 Prohibited Activities</h3>
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
            <p className="text-red-400 text-xs font-semibold mb-3">The following activities are strictly prohibited:</p>
            <ul className="space-y-2">
              {[
                'Fraud, money laundering, or terrorist financing',
                'Providing false or fraudulent identity documents',
                'Unauthorized access to accounts or systems',
                'Transactions involving illegal goods or services',
                'Violating sanctions lists (OFAC, UN, EU, AU)',
                'Creating multiple accounts to circumvent limits',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0 mt-2" />
                  <span className="text-white/70 text-xs">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ),
    },
    {
      id: 'privacy',
      title: '7. Data Privacy and Security',
      icon: Lock,
      content: (
        <>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            We collect, process, and store personal data in accordance with our Privacy Policy and applicable data protection laws.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">7.4 Your Data Rights</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            Under applicable data protection laws, you have the right to:
          </p>
          <ul className="space-y-2">
            {[
              'Access your personal data',
              'Correct inaccurate or incomplete data',
              'Request deletion of your data',
              'Object to or restrict certain data processing',
              'Withdraw consent for data processing',
              'Lodge a complaint with NITDA or your data protection authority',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-[#C7FF00] flex-shrink-0 mt-0.5" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: 'governing',
      title: '10. Governing Law',
      icon: Shield,
      content: (
        <>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            These Terms are governed by and construed in accordance with the laws of the State of Delaware, United States. BorderPay Africa, Inc. is incorporated as a Delaware C-Corporation and operates under its partners' regulatory frameworks.
          </p>
          
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <h3 className="text-white font-bold text-sm mb-3">Dispute Resolution Process</h3>
            <ol className="space-y-2">
              {[
                'Contact Support: support@borderpayafrica.com',
                'Good Faith Negotiation: 30 days',
                'Mediation: Through Lagos Multi-Door Courthouse',
                'Arbitration: Under the applicable rules of the State of Delaware, USA',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="text-[#C7FF00] font-bold text-sm flex-shrink-0">{index + 1}.</span>
                  <span className="text-white/70 text-sm">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      ),
    },
    {
      id: 'contact',
      title: '14. Contact Information',
      icon: Globe,
      content: (
        <>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            For questions, concerns, or support regarding these Terms or the Services, please contact us:
          </p>
          
          <div className="space-y-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">General Support</p>
              <a href="mailto:support@borderpayafrica.com" className="text-[#C7FF00] text-sm font-medium">
                support@borderpayafrica.com
              </a>
            </div>
            
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Legal & Compliance</p>
              <a href="mailto:legal@borderpayafrica.com" className="text-[#C7FF00] text-sm font-medium">
                legal@borderpayafrica.com
              </a>
            </div>
            
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Data Protection Officer</p>
              <a href="mailto:dpo@borderpayafrica.com" className="text-[#C7FF00] text-sm font-medium">
                dpo@borderpayafrica.com
              </a>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Address</p>
              <p className="text-white/90 text-sm leading-relaxed">
                BorderPay Africa<br />
                1111 B South Governors Avenue 39961<br />
                Dover, DE 19904, United States
              </p>
            </div>
          </div>

          <div className="bg-gradient-to-r from-[#C7FF00]/10 to-transparent border border-[#C7FF00]/20 rounded-2xl p-4 mt-4">
            <p className="text-xs text-white/70">
              <strong className="text-[#C7FF00]">Identity Verification by:</strong> BorderPay
            </p>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="min-h-full bg-black text-white">
      <FloatingBackButton onBack={onBack} />
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-floating-back pb-6 border-b border-white/10">
        <h1 className="text-2xl font-bold text-white mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-400">
          BorderPay Africa - Global Digital Banking
        </p>

        {/* Trust Badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">Protected by applicable law</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">Global</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">Data Privacy</span>
          </div>
        </div>
      </div>

      {/* Content - Scrollable */}
      <div 
        className="px-6 py-6"
        onScroll={handleScroll}
      >
        <div className="space-y-4 pb-safe">
          {sections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            const Icon = section.icon;

            return (
              <div
                key={section.id}
                className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
              >
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#C7FF00]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-[#C7FF00]" />
                    </div>
                    <span className="text-white font-semibold text-sm text-left">
                      {section.title}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {/* Section Content */}
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/10 px-5 py-4"
                  >
                    {section.content}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Accept Button (Fixed Bottom) */}
      {showAcceptButton && (
        <div className="flex-shrink-0 px-6 py-6 border-t border-white/10 bg-black">
          <motion.button
            onClick={onAccept}
            disabled={!hasScrolledToBottom}
            whileTap={{ scale: 0.98 }}
            className="w-full bg-[#C7FF00] text-black py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all hover:bg-[#D4FF33] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-5 h-5" />
            I Accept the Terms
          </motion.button>
          {!hasScrolledToBottom && (
            <p className="text-xs text-gray-500 text-center mt-2">
              Scroll to the bottom to accept
            </p>
          )}
        </div>
      )}
    </div>
  );
}
