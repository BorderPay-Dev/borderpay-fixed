import React from 'react';
import { Gift, Users, CalendarDays } from 'lucide-react';
import { FloatingBackButton } from '../common/FloatingBackButton';
import { openAffiliatePortal } from '../../utils/affiliate/openAffiliatePortal';

export function ReferralScreen({ onBack }: { onBack: () => void }) {
  return <div className="min-h-screen bg-[#0B0E11] pb-safe text-white">
    <FloatingBackButton onBack={onBack} />
    <header className="pt-safe-header px-5 py-5 text-center border-b border-white/5"><h1 className="text-lg font-bold">Business referrals</h1></header>
    <main className="max-w-lg mx-auto p-5 space-y-5">
      <section className="rounded-3xl bg-[#C7FF00] text-black p-6"><Gift size={30} /><h2 className="text-3xl font-bold mt-4">Get reduced incoming fees for 30 days</h2><p className="mt-3">Invite a business to BorderPay. When its business verification is approved, you earn a 30-day reward.</p></section>
      <section className="rounded-2xl border border-white/10 p-5 space-y-4">
        <div className="flex gap-3"><Users className="shrink-0 text-[#C7FF00]" /><p>Open your referral portal to copy your personal invitation link and track business signups and verification.</p></div>
        <div className="flex gap-3"><CalendarDays className="shrink-0 text-[#C7FF00]" /><p>Track earned rewards, activation and remaining days. Additional approved businesses earn consecutive 30-day periods.</p></div>
        <p className="text-sm text-gray-400">Eligible incoming payments: USD, EUR and GBP. Provider charges are separate. Rewards reduce fees and cannot be withdrawn as cash.</p>
      </section>
      <button className="w-full rounded-full bg-[#C7FF00] text-black font-bold p-4" onClick={() => void openAffiliatePortal('referral_screen')}>Open referral portal</button>
    </main>
  </div>;
}
