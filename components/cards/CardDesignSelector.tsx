/**
 * BorderPay Africa - Choose Card Design
 * 6 premium Fintech 2.0 card designs (3 Visa, 3 Mastercard).
 * Swipeable card carousel, color dots, VISA/MC toggle, deposit input,
 * activation fee notice, Cancel / Activate Card buttons.
 * User must explicitly tap a card design to select it before activation.
 * KYC verification gate — unverified users see a small inline prompt.
 * Theme + i18n aware.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, DollarSign, AlertCircle, Info, CheckCircle, ShieldAlert } from 'lucide-react';
import { useThemeLanguage, useThemeClasses } from '../../utils/i18n/ThemeLanguageContext';
import { BorderPayLogo } from './BorderPayLogo';
import { motion, AnimatePresence } from 'motion/react';

export interface CardDesign {
  id: string;
  name: string;
  gradient: string;
  cardType: 'visa' | 'mastercard';
  textColor: string;
  accentColor: string;
  glassOverlay?: string;
  decorColor?: string;
}

const CARD_DESIGNS: CardDesign[] = [
  {
    id: 'neon-surge',
    name: 'Neon Surge',
    gradient: 'linear-gradient(135deg, #00E676 0%, #00C853 25%, #00BFA5 55%, #00ACC1 100%)',
    cardType: 'visa',
    textColor: 'dark',
    accentColor: '#00E676',
    glassOverlay: 'radial-gradient(ellipse at 20% 80%, rgba(255,255,255,0.18) 0%, transparent 60%)',
    decorColor: 'rgba(0,230,118,0.25)',
  },
  {
    id: 'midnight-luxe',
    name: 'Midnight Luxe',
    gradient: 'linear-gradient(145deg, #0a0f1a 0%, #101829 30%, #162044 60%, #1a2a5e 100%)',
    cardType: 'mastercard',
    textColor: 'light',
    accentColor: '#C7FF00',
    glassOverlay: 'radial-gradient(ellipse at 75% 20%, rgba(199,255,0,0.06) 0%, transparent 55%)',
    decorColor: 'rgba(199,255,0,0.08)',
  },
  {
    id: 'carbon-elite',
    name: 'Carbon Elite',
    gradient: 'linear-gradient(160deg, #0c0c0c 0%, #161616 30%, #1e1e1e 60%, #2a2a2a 100%)',
    cardType: 'visa',
    textColor: 'light',
    accentColor: '#C7FF00',
    glassOverlay: 'radial-gradient(ellipse at 85% 85%, rgba(255,255,255,0.04) 0%, transparent 50%)',
    decorColor: 'rgba(199,255,0,0.06)',
  },
  {
    id: 'aurora-gold',
    name: 'Aurora Gold',
    gradient: 'linear-gradient(135deg, #1a1206 0%, #2d1f0e 25%, #3d2a10 50%, #5c3d12 80%, #7a5018 100%)',
    cardType: 'mastercard',
    textColor: 'light',
    accentColor: '#FFD700',
    glassOverlay: 'radial-gradient(ellipse at 30% 20%, rgba(255,215,0,0.12) 0%, transparent 55%)',
    decorColor: 'rgba(255,215,0,0.1)',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    gradient: 'linear-gradient(150deg, #060709 0%, #0d1017 30%, #111820 60%, #0B0E11 100%)',
    cardType: 'visa',
    textColor: 'light',
    accentColor: '#C7FF00',
    glassOverlay: 'radial-gradient(ellipse at 50% 0%, rgba(199,255,0,0.05) 0%, transparent 45%)',
    decorColor: 'rgba(199,255,0,0.04)',
  },
  {
    id: 'emerald-wave',
    name: 'Emerald Wave',
    gradient: 'linear-gradient(135deg, #002a1e 0%, #004D40 25%, #00695C 55%, #00897B 80%, #26A69A 100%)',
    cardType: 'mastercard',
    textColor: 'light',
    accentColor: '#C7FF00',
    glassOverlay: 'radial-gradient(ellipse at 80% 70%, rgba(38,166,154,0.15) 0%, transparent 55%)',
    decorColor: 'rgba(0,137,123,0.12)',
  },
];

const DOT_COLORS = ['#00E676', '#162044', '#1e1e1e', '#7a5018', '#0B0E11', '#00695C'];

interface CardDesignSelectorProps {
  onSelectDesign: (design: CardDesign, brand: 'VISA' | 'MASTERCARD', initialAmount: number) => void;
  onCancel: () => void;
  isActivating?: boolean;
  onNavigateToKYC?: () => void;
}

export function CardDesignSelector({ onSelectDesign, onCancel, isActivating = false, onNavigateToKYC }: CardDesignSelectorProps) {
  const [viewedIndex, setViewedIndex] = useState(0);
  const [confirmedIndex, setConfirmedIndex] = useState<number | null>(null);
  const [brand, setBrand] = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [depositAmount, setDepositAmount] = useState('10');
  const [showKYCPrompt, setShowKYCPrompt] = useState(false);
  const { t } = useThemeLanguage();
  const tc = useThemeClasses();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check KYC status from cached user profile
  const isVerified = (() => {
    try {
      const stored = localStorage.getItem('borderpay_user');
      if (!stored) return false;
      const user = JSON.parse(stored);
      return user.kyc_status === 'verified';
    } catch { return false; }
  })();

  const hasSelected = confirmedIndex !== null;
  const selectedDesign = hasSelected ? CARD_DESIGNS[confirmedIndex] : null;

  const handleConfirm = () => {
    if (!selectedDesign) return;

    // Gate: require KYC verification
    if (!isVerified) {
      setShowKYCPrompt(true);
      return;
    }

    const amount = parseFloat(depositAmount) || 0;
    onSelectDesign(
      { ...selectedDesign, cardType: brand.toLowerCase() as 'visa' | 'mastercard' },
      brand,
      amount
    );
  };

  const handleCardTap = (index: number) => {
    setViewedIndex(index);
    setConfirmedIndex(index);
    scrollToCard(index);
  };

  const scrollToCard = (index: number) => {
    setViewedIndex(index);
    if (scrollRef.current) {
      const cardWidth = scrollRef.current.offsetWidth * 0.78;
      const gap = 12;
      const scrollPos = index * (cardWidth + gap) - (scrollRef.current.offsetWidth - cardWidth) / 2;
      scrollRef.current.scrollTo({ left: scrollPos, behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const cardWidth = el.offsetWidth * 0.78;
    const gap = 12;
    const center = el.scrollLeft + el.offsetWidth / 2;
    let closest = 0;
    let minDist = Infinity;
    CARD_DESIGNS.forEach((_, i) => {
      const cardCenter = i * (cardWidth + gap) + cardWidth / 2;
      const dist = Math.abs(center - cardCenter);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    });
    setViewedIndex(closest);
  };

  return (
    <div className={`min-h-screen ${tc.bg} flex flex-col pb-safe`}>
      {/* Header */}
      <div className="px-5 pt-safe pb-3">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={onCancel}
            className={`w-8 h-8 flex items-center justify-center -ml-1`}
          >
            <ArrowLeft size={22} className={tc.text} />
          </button>
        </div>
        <h1 className={`text-xl font-bold ${tc.text} mt-1`}>{t('cards.chooseDesign') || 'Choose Card Design'}</h1>
        <p className={`text-sm ${tc.textSecondary} mt-0.5`}>{t('cards.tapToSelect') || 'Tap a card to select it'}</p>
      </div>

      {/* VISA / MC Toggle */}
      <div className="flex gap-3 px-5 mt-4">
        <button
          onClick={() => setBrand('VISA')}
          className={`flex-1 py-3.5 rounded-xl font-bold text-sm transition-all ${
            brand === 'VISA'
              ? 'bg-[#C7FF00] text-black'
              : `${tc.card} border ${tc.cardBorder} ${tc.textSecondary}`
          }`}
        >
          VISA
        </button>
        <button
          onClick={() => setBrand('MASTERCARD')}
          className={`flex-1 py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            brand === 'MASTERCARD'
              ? 'bg-[#C7FF00] text-black'
              : `${tc.card} border ${tc.cardBorder} ${tc.textSecondary}`
          }`}
        >
          <div className="flex -space-x-1.5">
            <div className="w-5 h-5 rounded-full bg-[#EB001B]" />
            <div className="w-5 h-5 rounded-full bg-[#F79E1B]" />
          </div>
          MC
        </button>
      </div>

      {/* Card Carousel */}
      <div className="mt-6 mb-4 flex-shrink-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 sm:px-[11%]"
          style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'auto', overscrollBehaviorX: 'none' } as React.CSSProperties}
        >
          {CARD_DESIGNS.map((design, idx) => {
            const isDark = design.textColor === 'light';
            const isViewed = idx === viewedIndex;
            const isConfirmed = idx === confirmedIndex;
            const isGold = design.id === 'aurora-gold';
            const numColor = isDark ? (isGold ? '#FFD700' : '#C7FF00') : 'rgba(0,0,0,0.85)';

            return (
              <div
                key={design.id}
                className="flex-shrink-0 snap-center cursor-pointer w-[80%] sm:w-[78%]"
                onClick={() => handleCardTap(idx)}
              >
                <div
                  className={`relative rounded-2xl overflow-hidden transition-all duration-200 ${
                    isConfirmed ? 'ring-2 ring-[#C7FF00] ring-offset-2' : ''
                  }`}
                  style={{
                    aspectRatio: '1.586/1',
                    opacity: isViewed ? 1 : 0.55,
                    transform: isViewed ? 'scale(1)' : 'scale(0.92)',
                    boxShadow: isViewed
                      ? ("0 8px 32px -4px " + (design.decorColor || "rgba(0,0,0,0.4)") + ", 0 2px 12px rgba(0,0,0,0.5)")
                      : "0 4px 16px rgba(0,0,0,0.3)",
                    // ringOffsetColor handled via className
                  }}
                >
                  <div className="absolute inset-0" style={{ background: design.gradient }} />
                  {design.glassOverlay && (
                    <div className="absolute inset-0" style={{ background: design.glassOverlay }} />
                  )}
                  {isDark && (
                    <div
                      className="absolute inset-0 rounded-2xl pointer-events-none"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                    />
                  )}
                  <div
                    className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
                    style={{
                      background: "radial-gradient(circle, " + (design.decorColor || "rgba(255,255,255,0.03)") + " 0%, transparent 70%)",
                    }}
                  />

                  {/* Selected check badge */}
                  {isConfirmed && (
                    <div className="absolute top-3 right-3 z-20 w-7 h-7 rounded-full bg-[#C7FF00] flex items-center justify-center">
                      <CheckCircle size={16} className="text-black" />
                    </div>
                  )}

                  <div className="relative h-full p-5 flex flex-col justify-between z-10">
                    {/* Top: Logo only */}
                    <div className="flex items-start justify-between">
                      <BorderPayLogo color={isDark ? '#ffffff' : '#000000'} size={36} />
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Bottom: 3 dots (left) + Brand (right) */}
                    <div className="flex items-end justify-between">
                      {/* Left: 3 dots */}
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2].map(d => (
                          <div
                            key={d}
                            className="w-[6px] h-[6px] rounded-full"
                            style={{ backgroundColor: numColor, opacity: 0.5 }}
                          />
                        ))}
                      </div>

                      {/* Right: VISA / Mastercard brand */}
                      {brand === 'VISA' ? (
                        <span
                          className="text-2xl font-black tracking-wider"
                          style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' }}
                        >
                          VISA
                        </span>
                      ) : (
                        <div className="flex -space-x-3">
                          <div className="w-10 h-10 rounded-full bg-[#EB001B] opacity-90" />
                          <div className="w-10 h-10 rounded-full bg-[#F79E1B] opacity-90" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Design Name */}
        <p className={`text-center text-base font-semibold ${tc.text} mt-4`}>
          {CARD_DESIGNS[viewedIndex].name}
        </p>

        {/* Color Dots */}
        <div className="flex items-center justify-center gap-3 mt-3">
          {DOT_COLORS.map((color, idx) => (
            <button
              key={idx}
              onClick={() => handleCardTap(idx)}
              className={`w-8 h-8 rounded-full transition-all ${
                idx === confirmedIndex
                  ? 'ring-2 ring-[#C7FF00]/50 ring-offset-2 scale-110'
                  : idx === viewedIndex
                  ? 'ring-2 ring-white/30 ring-offset-2 scale-105'
                  : 'opacity-60'
              }`}
              style={{
                background: color,
                boxShadow: idx === confirmedIndex ? `0 0 12px ${color}55` : 'none',
                // ringOffsetColor handled via className
              }}
            />
          ))}
        </div>
      </div>

      {/* Card Deposit */}
      <div className="px-5 mt-4">
        <p className={`text-sm ${tc.textSecondary} font-medium mb-2`}>{t('cards.cardDeposit') || 'Card Deposit (USD)'}</p>
        <div className="relative">
          <span className={`absolute left-4 top-1/2 -translate-y-1/2 ${tc.textSecondary} text-lg font-medium`}>$</span>
          <input
            type="number"
            inputMode="decimal"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="10"
            className={`w-full ${tc.inputBg || 'bg-white/5'} border ${tc.borderLight} rounded-2xl pl-10 pr-4 py-4 text-lg font-bold ${tc.text} focus:outline-none focus:border-[#C7FF00]/40`}
          />
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2">
            <Info size={14} className={`${tc.textSecondary} mt-0.5 flex-shrink-0`} />
            <p className={`text-xs ${tc.textSecondary} leading-relaxed`}>
              {t('cards.minDepositInfo') || 'Minimum deposit $10. You can deposit $10, $100 or more — funds go directly to your card.'}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-yellow-500/70 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-500/70 leading-relaxed">
              {t('cards.activationFeeInfo') || '$3.50 one-time activation fee is added. Non-refundable.'}
            </p>
          </div>
        </div>
      </div>

      {/* KYC Verification Inline Prompt */}
      <AnimatePresence>
        {showKYCPrompt && !isVerified && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 overflow-hidden"
          >
            <div className="mt-3 flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-2.5">
              <ShieldAlert size={16} className="text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-300 leading-snug flex-1">
                Verify your identity to activate a card.
              </p>
              {onNavigateToKYC && (
                <button
                  onClick={onNavigateToKYC}
                  className="text-[11px] font-bold text-[#C7FF00] whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#C7FF00]/10 active:scale-95 transition-transform"
                >
                  Verify Now
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Buttons */}
      <div className="flex gap-3 px-5 pt-5 pb-safe">
        <button
          onClick={onCancel}
          disabled={isActivating}
          className={`flex-[0.4] py-4 rounded-full ${tc.card} border ${tc.cardBorder} ${tc.text} font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-40`}
        >
          {t('common.cancel') || 'Cancel'}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!hasSelected || !depositAmount || parseFloat(depositAmount) < 10 || isActivating}
          className={`flex-[0.6] py-4 rounded-full font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            hasSelected
              ? 'bg-[#C7FF00] text-black'
              : 'bg-[#C7FF00]/10 border border-[#C7FF00]/30 text-[#C7FF00]'
          }`}
        >
          {isActivating ? (
            <>
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              {t('common.processing') || 'Activating...'}
            </>
          ) : !hasSelected ? (
            t('cards.selectDesignFirst') || 'Select a Design'
          ) : (
            t('cards.activateCard') || 'Activate Card'
          )}
        </button>
      </div>
    </div>
  );
}