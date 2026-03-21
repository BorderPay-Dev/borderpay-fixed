/**
 * BorderPay Africa - Referral Screen
 * Share BorderPay with friends and earn $90
 */

import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Gift, Users, DollarSign, Zap, ChevronRight, Share2, Copy, CheckCircle } from 'lucide-react';

interface ReferralScreenProps {
  onBack: () => void;
}

export function ReferralScreen({ onBack }: ReferralScreenProps) {
  const [copied, setCopied] = React.useState(false);
  const referralLink = 'https://affiliate.borderpayafrica.com';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join BorderPay Africa',
          text: 'Send money across Africa with zero fees on your first transfer up to $500! Join me on BorderPay.',
          url: referralLink,
        });
      } catch { /* user cancelled */ }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-[#0B0E11]/90 backdrop-blur-md border-b border-white/5 z-40">
        <div className="flex items-center gap-3 px-5 py-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center"
          >
            <ArrowLeft size={20} className="text-white" />
          </motion.button>
          <h1 className="text-lg font-bold text-white">Refer & Earn</h1>
        </div>
      </div>

      <div className="px-5 pt-6">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#C7FF00] via-[#B8F000] to-[#9AD600] p-6 pb-8 mb-6"
        >
          {/* Background decorative circles */}
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-black/5" />
          <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-black/5" />
          <div className="absolute top-1/2 right-1/4 w-20 h-20 rounded-full bg-white/10" />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-black/10 flex items-center justify-center">
                <Gift size={22} className="text-black" />
              </div>
              <span className="text-black/60 text-sm font-semibold uppercase tracking-wider">Referral Program</span>
            </div>

            <h2 className="text-4xl font-black text-black leading-tight mb-2">
              Earn <span className="inline-block">$90</span>
            </h2>
            <p className="text-black/70 text-base font-medium leading-relaxed">
              Share BorderPay with <span className="text-black font-bold">4 friends</span> and earn <span className="text-black font-bold">$90</span> for yourself.
            </p>
          </div>
        </motion.div>

        {/* What your friends get */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-[#1A1D21] border border-white/5 rounded-2xl p-5 mb-5"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#C7FF00]/10 flex items-center justify-center">
              <Users size={20} className="text-[#C7FF00]" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Your friends get</h3>
              <p className="text-gray-500 text-xs">When they sign up with your link</p>
            </div>
          </div>
          <div className="bg-[#C7FF00]/5 border border-[#C7FF00]/10 rounded-xl p-4">
            <p className="text-[#C7FF00] font-bold text-lg mb-1">Zero fees</p>
            <p className="text-gray-400 text-sm">on their first transfer up to <span className="text-white font-semibold">$500</span></p>
          </div>
        </motion.div>

        {/* How it works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-[#1A1D21] border border-white/5 rounded-2xl p-5 mb-5"
        >
          <h3 className="text-white font-bold text-sm mb-4">How it works</h3>
          <div className="space-y-4">
            {[
              { icon: Share2, title: 'Share your link', desc: 'Send your unique referral link to friends & family', color: '#C7FF00' },
              { icon: Users, title: 'Friends sign up', desc: 'They create a BorderPay account and make a transfer', color: '#3B82F6' },
              { icon: DollarSign, title: 'You earn $22.50 each', desc: 'Get paid for every friend who completes a transfer', color: '#10B981' },
              { icon: Zap, title: 'Stack it up', desc: '4 friends = $90 in your wallet. No limits on referrals!', color: '#F59E0B' },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="relative flex-shrink-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `${step.color}15` }}
                  >
                    <step.icon size={18} style={{ color: step.color }} />
                  </div>
                  {i < 3 && (
                    <div className="absolute top-10 left-1/2 -translate-x-1/2 w-px h-4 bg-white/10" />
                  )}
                </div>
                <div className="pt-1">
                  <p className="text-white text-sm font-semibold">{step.title}</p>
                  <p className="text-gray-500 text-xs leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Referral link copy section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-[#1A1D21] border border-white/5 rounded-2xl p-5 mb-8"
        >
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Your referral link</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 truncate">
              <span className="text-white text-sm font-mono">{referralLink}</span>
            </div>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleCopy}
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                copied ? 'bg-green-500/20' : 'bg-white/5'
              }`}
            >
              {copied ? (
                <CheckCircle size={20} className="text-green-400" />
              ) : (
                <Copy size={18} className="text-gray-400" />
              )}
            </motion.button>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="pb-6"
        >
          <motion.a
            href="https://affiliate.borderpayafrica.com"
            target="_blank"
            rel="noopener noreferrer"
            whileTap={{ scale: 0.97 }}
            className="block w-full py-4 bg-[#C7FF00] text-black font-bold text-center rounded-2xl text-sm active:bg-[#B8F000] transition-colors"
          >
            Earn Now
          </motion.a>
          <p className="text-center text-gray-600 text-[11px] mt-3">
            Terms apply. Rewards credited after friend's first qualifying transfer.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
