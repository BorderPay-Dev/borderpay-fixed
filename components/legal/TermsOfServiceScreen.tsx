/**
 * BorderPay Africa - Terms of Service Screen
 * Full scrollable terms with sections, beautiful typography
 * Mobile-optimized with neon green accents
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Shield, Globe, Lock, ChevronDown, ChevronUp, Check } from 'lucide-react';

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
          <h3 className="text-white font-bold text-sm mb-3">1.1 Pan-African Service</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            BorderPay Africa is a Pan-African digital banking platform serving African citizens and residents only. Our Services are available to individuals and businesses from all African countries, except those on international sanctions lists or restricted by our compliance policies.
          </p>
          
          <h3 className="text-white font-bold text-sm mb-3">1.2 Eligible African Countries</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            We onboard users from all 54 African countries, including but not limited to: Nigeria, Kenya, Tanzania, Ghana, South Africa, Egypt, Morocco, Ethiopia, Uganda, Rwanda, Senegal, Côte d'Ivoire, Cameroon, and many more.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">1.3 Restricted Countries</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            Due to international sanctions, compliance requirements, or regulatory restrictions, we may not be able to onboard users from certain jurisdictions or those appearing on OFAC, UN, EU, or AU sanctions lists.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">1.4 Age and Capacity</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-4">
            You must be at least 18 years old (or the age of majority in your African jurisdiction) to use the Services.
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
              'Provide only African government-issued identification documents',
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
          <h3 className="text-white font-bold text-sm mb-3">2.1 African Identity Documents Only</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            BorderPay Africa accepts African government-issued identity documents only. Accepted documents include:
          </p>
          <ul className="space-y-2 mb-4">
            {[
              'African Passport: Valid passport issued by any African country',
              'National ID Card: Government-issued national identity card',
              'Driver\'s License: Valid driver\'s license from select African countries',
            ].map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-[#C7FF00] rounded-full flex-shrink-0 mt-2" />
                <span className="text-white/70 text-sm">{item}</span>
              </li>
            ))}
          </ul>
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-3 mb-4">
            <p className="text-red-400 text-xs font-semibold">
              Important: We do NOT accept identity documents from non-African countries.
            </p>
          </div>

          <h3 className="text-white font-bold text-sm mb-3">2.2 Verification Process</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            Identity verification is powered by Smile ID, a Mastercard partner and leading African RegTech provider. The verification process:
          </p>
          <ul className="space-y-2">
            {[
              'Typically completes within 5-15 minutes',
              'Requires a clear photo of your African ID document',
              'May require a selfie for biometric verification',
              'Fully compliant with African Union AML regulations',
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
            BorderPay Africa provides a mobile application and digital banking platform for Pan-African cross-border payments, remittances, multi-currency digital wallets, virtual cards, and related fintech services.
          </p>
          
          <h3 className="text-white font-bold text-sm mb-3">Core Services:</h3>
          <div className="grid grid-cols-1 gap-2 mb-4">
            {[
              'Digital Wallet: Multi-currency support',
              'Virtual Cards: Virtual Visa/Mastercard for online payments',
              'Apple Pay & Google Pay: Digital wallet integration',
              'Cross-Border Payments: International transfers',
              'Mobile Money Integration: Connect with African mobile money providers',
              'Remittances: Send and receive money across Africa',
              'Currency Exchange: Hold and exchange major currencies',
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
              'Multi-currency wallets (USD + African currencies)',
              'Virtual card issuance — $3.50 one-time issuance fee',
              'Apple Pay & Google Pay integration',
              'Stablecoin support (USDT, USDC)',
              'Mobile money integration',
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
              <strong className="text-white">Fee Structure:</strong> All fees are charged in USD and displayed transparently before transaction confirmation. Fees are non-refundable except as required by applicable Nigerian consumer protection laws.
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
              'Use only African government-issued identity documents',
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
                'Use of non-African identity documents',
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
            We collect, process, and store personal data in accordance with our Privacy Policy and applicable African data protection laws, including Nigeria Data Protection Regulation (NDPR) and the African Union Convention on Cyber Security and Personal Data Protection.
          </p>

          <h3 className="text-white font-bold text-sm mb-3">7.4 Your Data Rights</h3>
          <p className="text-white/70 text-sm leading-relaxed mb-3">
            Under NDPR and applicable African data protection laws, you have the right to:
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
            These Terms are governed by and construed in accordance with the laws of the Federal Republic of Nigeria. Any disputes shall be subject to the exclusive jurisdiction of the courts of Lagos State, Federal Republic of Nigeria.
          </p>
          
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <h3 className="text-white font-bold text-sm mb-3">Dispute Resolution Process</h3>
            <ol className="space-y-2">
              {[
                'Contact Support: support@borderpayafrica.com',
                'Good Faith Negotiation: 30 days',
                'Mediation: Through Lagos Multi-Door Courthouse',
                'Arbitration: Under Nigerian Arbitration and Conciliation Act',
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
              <strong className="text-[#C7FF00]">Identity Verification by:</strong> Smile ID (Mastercard Partner)
            </p>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="min-h-full bg-black text-white">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-6 pt-safe border-b border-white/10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-white/70 hover:text-white transition-colors mb-4 min-h-[44px]"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </button>

        <h1 className="text-2xl font-bold text-white mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-400">
          BorderPay Africa - Pan-African Digital Banking
        </p>

        {/* Trust Badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">Protected by Nigerian law</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">Pan-African</span>
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