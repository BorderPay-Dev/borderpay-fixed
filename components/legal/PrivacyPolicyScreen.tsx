/**
 * BorderPay Africa - Privacy Policy Screen
 * NDPR compliant, mobile-optimized
 */

import React from 'react';
import { ArrowLeft, Shield, Lock, Eye, Database, UserCheck, AlertTriangle } from 'lucide-react';

interface PrivacyPolicyScreenProps {
  onBack: () => void;
}

export function PrivacyPolicyScreen({ onBack }: PrivacyPolicyScreenProps) {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-400">
          How we protect your data
        </p>

        {/* Trust Badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">NDPR Compliant</span>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#C7FF00]" />
            <span className="text-xs text-white/70">TLS 1.3+ Encryption</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        <div className="space-y-6 pb-safe">
          {/* Data We Collect */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#C7FF00]/20 rounded-xl flex items-center justify-center">
                <Database className="w-5 h-5 text-[#C7FF00]" />
              </div>
              <h2 className="text-white font-bold text-base">Data We Collect</h2>
            </div>
            <ul className="space-y-3">
              {[
                'Personal Information: Name, email, phone number, date of birth',
                'Identity Documents: African government-issued ID only',
                'Financial Information: Transaction history, wallet balances',
                'Device Information: IP address, device type, operating system',
                'Biometric Data: Selfies for identity verification (Smile ID)',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-[#C7FF00] rounded-full flex-shrink-0 mt-2" />
                  <span className="text-white/70 text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* How We Use Your Data */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#C7FF00]/20 rounded-xl flex items-center justify-center">
                <UserCheck className="w-5 h-5 text-[#C7FF00]" />
              </div>
              <h2 className="text-white font-bold text-base">How We Use Your Data</h2>
            </div>
            <ul className="space-y-3">
              {[
                'Account Management: Create and maintain your account',
                'KYC/AML Compliance: Verify identity and prevent fraud',
                'Transaction Processing: Execute payments and transfers',
                'Customer Support: Respond to inquiries and resolve issues',
                'Service Improvements: Analyze usage patterns and feedback',
                'Legal Compliance: Meet regulatory requirements',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-[#C7FF00] rounded-full flex-shrink-0 mt-2" />
                  <span className="text-white/70 text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Data Sharing */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#C7FF00]/20 rounded-xl flex items-center justify-center">
                <Eye className="w-5 h-5 text-[#C7FF00]" />
              </div>
              <h2 className="text-white font-bold text-base">Who We Share Data With</h2>
            </div>
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-white font-semibold text-sm mb-1">FDIC-Insured Banking Partner</p>
                <p className="text-white/70 text-xs">Payment processing, virtual cards, wallet infrastructure</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-white font-semibold text-sm mb-1">Smile ID</p>
                <p className="text-white/70 text-xs">KYC/AML identity verification (Mastercard partner)</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-white font-semibold text-sm mb-1">Regulatory Authorities</p>
                <p className="text-white/70 text-xs">As required by law (NFIU, EFCC, etc.)</p>
              </div>
            </div>
          </section>

          {/* Your Rights (NDPR) */}
          <section className="bg-gradient-to-br from-[#C7FF00]/10 to-transparent border border-[#C7FF00]/30 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#C7FF00] rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-black" />
              </div>
              <h2 className="text-white font-bold text-base">Your Data Rights (NDPR)</h2>
            </div>
            <p className="text-white/70 text-sm mb-4 leading-relaxed">
              Under Nigeria's Data Protection Regulation (NDPR) and African Union data protection laws, you have the right to:
            </p>
            <ul className="space-y-2">
              {[
                'Access: Request a copy of your personal data',
                'Correction: Update inaccurate or incomplete data',
                'Deletion: Request deletion of your data (subject to legal retention)',
                'Objection: Object to certain data processing activities',
                'Portability: Receive your data in a machine-readable format',
                'Complaint: Lodge a complaint with NITDA or your data protection authority',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-5 h-5 bg-[#C7FF00]/20 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 bg-[#C7FF00] rounded-full" />
                  </div>
                  <span className="text-white/90 text-sm font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Data Security */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#C7FF00]/20 rounded-xl flex items-center justify-center">
                <Lock className="w-5 h-5 text-[#C7FF00]" />
              </div>
              <h2 className="text-white font-bold text-base">Data Security</h2>
            </div>
            <p className="text-white/70 text-sm mb-4 leading-relaxed">
              We implement industry-standard security measures to protect your data:
            </p>
            <ul className="space-y-2">
              {[
                'TLS 1.3+ Encryption: All data transmitted securely',
                'AES-256 Encryption: Data encrypted at rest',
                'Two-Factor Authentication: Optional 2FA with Google Authenticator',
                'PIN Protection: 6-digit PIN for transactions',
                'Biometric Authentication: Fingerprint/Face ID support',
                'Regular Security Audits: Continuous monitoring and testing',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-[#C7FF00] rounded-full flex-shrink-0 mt-2" />
                  <span className="text-white/70 text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Data Retention */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#C7FF00]/20 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-[#C7FF00]" />
              </div>
              <h2 className="text-white font-bold text-base">Data Retention</h2>
            </div>
            <p className="text-white/70 text-sm leading-relaxed">
              We retain your data for as long as necessary to provide Services and comply with legal obligations. Under Nigerian banking regulations, we must retain financial records for 6-10 years after account closure for audit and compliance purposes.
            </p>
          </section>

          {/* Contact DPO */}
          <section className="bg-gradient-to-r from-[#C7FF00]/10 to-transparent border border-[#C7FF00]/20 rounded-2xl p-5">
            <h3 className="text-white font-bold text-sm mb-3">Exercise Your Rights</h3>
            <p className="text-white/70 text-sm mb-4 leading-relaxed">
              To access, correct, delete, or export your data, contact our Data Protection Officer:
            </p>
            <a 
              href="mailto:dpo@borderpayafrica.com"
              className="block bg-[#C7FF00] text-black px-4 py-3 rounded-xl font-semibold text-sm text-center hover:bg-[#D4FF33] transition-all"
            >
              dpo@borderpayafrica.com
            </a>
            <p className="text-xs text-white/50 mt-3 text-center">
              We will respond within 30 days
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}