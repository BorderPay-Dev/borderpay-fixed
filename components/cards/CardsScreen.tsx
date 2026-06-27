/**
 * BorderPay Africa — Cards
 *
 * Product rule:
 * - Let users explore the card UI.
 * - Block only card-creation actions with a "Coming soon" message.
 */

import React, { useMemo, useState } from 'react';
import { CreditCard, Lock, List, SlidersHorizontal, Receipt } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { authAPI } from '../../utils/supabase/client';
import { BorderPayLogo } from './BorderPayLogo';

interface CardsScreenProps {
  onBack: () => void;
}

function CardChip() {
  return (
    <div className="w-[44px] h-[34px] rounded-md bg-gradient-to-br from-[#f4f4f4] via-[#cfcfcf] to-[#9b9b9b] border border-white/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.45)]">
      <div className="h-full w-full grid grid-cols-3 grid-rows-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-[0.5px] border-black/10" />
        ))}
      </div>
    </div>
  );
}

function CardFace({ cardType = 'PERSONAL CARD' }: { cardType?: string }) {
  return (
    <div
      className="rounded-[22px] border border-[#C7FF00]/55 overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 100% at 20% 15%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 28%, rgba(0,0,0,0.0) 55%), linear-gradient(125deg, #08090B 0%, #14171C 50%, #0C0E12 100%)',
        boxShadow: '0 14px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(199,255,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: 'repeating-linear-gradient(105deg, rgba(255,255,255,0.25) 0px, rgba(255,255,255,0.1) 1px, transparent 2px, transparent 9px)',
        }}
      />
      <div className="relative z-10 h-full flex flex-col px-5 py-4">
        <p className="text-[10px] tracking-[0.2em] font-semibold text-white/55 uppercase">{cardType}</p>
        <div className="mt-4 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <BorderPayLogo color="#C7FF00" size={56} showRegistered={false} />
            </div>
            <div className="leading-none">
              <p className="text-white font-semibold text-[28px] tracking-tight">BorderPay<span className="text-[12px] align-top ml-0.5">®</span></p>
              <p className="text-white/90 text-[15px] mt-1 italic">Africa</p>
            </div>
          </div>
          <div className="mt-3 mr-1"><CardChip /></div>
        </div>
        <div className="mt-auto flex items-end justify-end pr-1 pb-1">
          <p className="text-[56px] leading-none font-bold tracking-[-0.02em] bg-gradient-to-br from-[#f4f4f4] via-[#c9c9c9] to-[#8f8f8f] bg-clip-text text-transparent">VISA</p>
        </div>
      </div>
    </div>
  );
}

function CardMockup({ cardType }: { cardType: string }) {
  return (
    <div className="mt-4 rounded-3xl border border-[#C7FF00]/25 bg-black/60 p-4 sm:p-5 overflow-hidden">
      <div className="mx-auto w-full max-w-[760px]">
        <CardFace cardType={cardType} />
      </div>
    </div>
  );
}

export function CardsScreen({ onBack: _onBack }: CardsScreenProps) {
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'controls' | 'activity'>('overview');
  const user = authAPI.getStoredUser();

  const title       = (t as any)?.('cards.title')    ?? 'Cards';
  const subtitle    = (t as any)?.('cards.subtitle') ?? 'Coming soon';
  const sectionTitle = 'Cards';
  const accountType = String(user?.account_type || 'individual').toLowerCase();
  const isBusiness = accountType === 'business';
  const cardTypeLabel = isBusiness ? 'TEAM CARD' : 'PERSONAL CARD';

  const cardTabs = useMemo(() => ([
    { id: 'overview' as const, label: 'Overview', icon: List },
    { id: 'controls' as const, label: 'Controls', icon: SlidersHorizontal },
    { id: 'activity' as const, label: 'Activity', icon: Receipt },
  ]), []);

  return (
    <div className={`min-h-screen ${tc.bg}`}>
      <div className="max-w-2xl mx-auto px-4 sm:px-5 pt-5 pb-10">
        {/* Section eyebrow (replaces the old duplicate top bar) */}
        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${tc.textMuted} mb-4`}>
          {sectionTitle}
        </p>

        <div className={`rounded-3xl border ${tc.cardBorder} ${tc.card} p-5 sm:p-6 max-w-2xl`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#C7FF00]/20 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-6 h-6 text-[#C7FF00]" />
            </div>
            <div className="min-w-0">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${tc.borderLight} ${tc.bgAlt} mb-3`}>
                <Lock className={`w-3 h-3 ${tc.textMuted}`} />
                <span className={`text-[10px] font-bold tracking-wider uppercase ${tc.textMuted}`}>Coming soon</span>
              </div>
              <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
                {title}
              </h1>
              <p className={`text-sm ${tc.textMuted} leading-relaxed`}>
                {subtitle}
              </p>
            </div>
          </div>
        </div>

        <CardMockup cardType={cardTypeLabel} />

        <div className={`mt-5 rounded-2xl border ${tc.cardBorder} ${tc.card} p-2 flex items-center gap-2`}>
          {cardTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${active ? 'bg-[#C7FF00] text-black' : `${tc.textMuted} ${tc.hoverBg}`}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 max-w-2xl">
          <h1 className={`text-2xl sm:text-3xl font-semibold ${tc.text} tracking-tight mb-2`}>
            No card can be issued yet
          </h1>
          <p className={`text-sm ${tc.textMuted} leading-relaxed`}>Coming soon</p>
          {message && (
            <p className={`mt-2 text-xs ${tc.textMuted}`}>{message}</p>
          )}

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={false}
              aria-disabled={false}
              onClick={() => {
                setMessage('Card creation is locked. Coming soon.');
              }}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.text} ${tc.hoverBg}`}
            >
              <Lock className="w-4 h-4" />
              <span className="text-xs font-semibold">Create card</span>
            </button>
            <button
              type="button"
              disabled={false}
              aria-disabled={false}
              onClick={() => {
                setMessage('Coming soon.');
              }}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border ${tc.cardBorder} ${tc.text} ${tc.hoverBg}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="text-xs font-semibold">Spending controls</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CardsScreen;
